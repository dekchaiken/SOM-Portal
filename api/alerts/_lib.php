<?php
// ══════════════════════════════════════════════════════════════════════
// api/alerts/_lib.php  |  Shared helpers for the custom alert system
// ══════════════════════════════════════════════════════════════════════
// This file backs the "Custom Alerts" feature reachable from the
// service-performance page: users create rules like "CPU > 80% for 60s"
// and the browser-side scheduler in noti-scheduler.js polls tick.php
// every 30s. All eval + dedup + Google-Chat send happens server-side so
// N concurrent tabs still produce at most one notification per state
// transition.
//
// Storage layout (per team, under data/<team>/alerts/):
//   rules.json          — [{ id, service, metric, op, threshold, ... }]
//   state.json          — { <ruleId>: { state, sinceTs, lastFireTs } }
//   notify-config.json  — { channels: { <name>: { webhook_url } } }
//   tick.lock           — global mutex during evaluation
//   last-tick.txt       — throttle marker (seconds since epoch)
// ══════════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';

const ALERTS_DIR              = 'alerts';
const ALERTS_RULES_FILE       = 'alerts/rules.json';
const ALERTS_STATE_FILE       = 'alerts/state.json';
const ALERTS_NOTIFY_CFG_FILE  = 'alerts/notify-config.json';
const ALERTS_TICK_LOCK        = 'alerts/tick.lock';
const ALERTS_TICK_MARKER      = 'alerts/last-tick.txt';

// Metrics that alert rules can watch. Each maps to a PromQL template
// that the tick handler renders with the target service's context (name,
// namespace, cluster) at evaluation time. Keep in sync with the frontend
// dropdown labels so the UI can't offer a metric backend doesn't know.
function alertMetricsCatalog(): array {
    // Each entry describes ONE thing an alert can watch. Keys documented:
    //   label       — UI dropdown text (Thai + English hybrid for clarity)
    //   groupLabel  — <optgroup> label — groups metrics by threshold unit
    //                 so users understand "% of limit" vs "raw ms" at a glance
    //   description — one-line explanation shown under the dropdown when
    //                 this metric is selected. Answers "what does this catch?"
    //   suggested   — sensible default threshold (pre-fills the input on select)
    //   aggregation — how live value is reduced across pods (avg / max / min / sum)
    //                 — displayed in UI so users know what they're comparing to
    //   unit        — display formatter tag (ms/pct/bytes/cores/reqs)
    //   source      — 'kube' (cAdvisor/kube-state) or 'jvm' (Micrometer)
    //   compareAs   — 'abs' (raw units) or 'pct' (% of limitQuery result)
    //   liveQuery   / limitQuery — PromQL templates (see tick.php)
    return [
        // ─── PERCENTAGE-OF-LIMIT metrics (threshold = 0-100) ─────────────
        'cpu' => [
            'label'       => 'CPU % of limit (avg ต่อ pod)',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'CPU เฉลี่ยข้าม pod ทั้งหมด เทียบกับ CPU limit ต่อ pod. ' .
                             'ตัวอย่าง 80 = ยิงเมื่อ avg CPU ทั้ง service ≥ 80% ของ limit. ' .
                             'ใช้จับ overall utilization — ไม่จับ pod เดียว hot',
            'suggested'   => 80,
            'aggregation' => 'avg ข้าม pods (avg by workload)',
            'unit'        => 'cores',
            'source'      => 'kube',
            'compareAs'   => 'pct',
            'liveQuery'   => 'avg(rate(container_cpu_usage_seconds_total{{{sel}},{{contSel}}}[2m]))',
            'limitQuery'  => 'avg(kube_pod_container_resource_limits{{{sel}},{{contSel}},resource="cpu"})',
        ],
        'mem' => [
            'label'       => 'Memory % of limit (avg ต่อ pod)',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'Memory (working set) เฉลี่ยข้าม pod เทียบกับ memory limit. ' .
                             '85 = ยิงเมื่อ ~ใกล้ OOM. ใช้จับ workload-wide memory pressure',
            'suggested'   => 85,
            'aggregation' => 'avg ข้าม pods',
            'unit'        => 'bytes',
            'source'      => 'kube',
            'compareAs'   => 'pct',
            'liveQuery'   => 'avg(container_memory_working_set_bytes{{{sel}},{{contSel}}})',
            'limitQuery'  => 'avg(kube_pod_container_resource_limits{{{sel}},{{contSel}},resource="memory"})',
        ],
        'cpu_pod_max' => [
            'label'       => 'CPU % of limit (by pod — ยิงถ้า pod ใดเกิน)',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'ตรวจ CPU usage ของ <b>แต่ละ pod แยกกัน</b> เทียบกับ CPU limit. ' .
                             'ต่างจาก cpu (avg) — ตัวนี้ยิงทันทีเมื่อ <i>pod ใดตัวหนึ่ง</i> เกิน threshold ' .
                             'และ notification จะบอกชื่อ pod ที่ hot. ' .
                             '80 = warn, 95 = critical (pod เดียวกำลังจะโดน throttle หนัก)',
            'suggested'   => 80,
            'aggregation' => 'per-pod (ยิงถ้า pod ใดเกิน threshold)',
            'unit'        => 'cores',
            'source'      => 'kube',
            'compareAs'   => 'pct',
            'byPod'       => true,
            'liveQuery'   => 'rate(container_cpu_usage_seconds_total{{{sel}},{{contSel}}}[2m])',
            'limitQuery'  => 'avg(kube_pod_container_resource_limits{{{sel}},{{contSel}},resource="cpu"})',
        ],
        'mem_pod_max' => [
            'label'       => 'Memory % of limit (by pod — ยิงถ้า pod ใดเกิน)',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'ตรวจ memory usage ของ <b>แต่ละ pod แยกกัน</b> เทียบกับ memory limit. ' .
                             'ต่างจาก mem (avg) — ตัวนี้ยิงทันทีเมื่อ <i>pod ใดตัวหนึ่ง</i> เกิน threshold ' .
                             'และ notification จะบอกชื่อ pod ที่ละเมิดทุกตัว. ' .
                             '85 = warn เมื่อมี pod ใดตัวหนึ่งเกิน 85% (OOMKill เกิดที่ ~100%)',
            'suggested'   => 85,
            'aggregation' => 'per-pod (ยิงถ้า pod ใดเกิน threshold)',
            'unit'        => 'bytes',
            'source'      => 'kube',
            'compareAs'   => 'pct',
            'byPod'       => true,
            'liveQuery'   => 'container_memory_working_set_bytes{{{sel}},{{contSel}}}',
            'limitQuery'  => 'avg(kube_pod_container_resource_limits{{{sel}},{{contSel}},resource="memory"})',
        ],
        'heap_pct' => [
            'label'       => 'JVM Heap %',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'Heap used / heap max ของ JVM (avg ข้าม pods). ' .
                             '85 = warn (GC บ่อยขึ้น), 90 = critical (ใกล้ OOMError). ' .
                             'ใช้จับ heap pressure / memory leak',
            'suggested'   => 85,
            'aggregation' => 'avg ข้าม pods',
            'unit'        => 'pct',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'avg(jvm_memory_used_bytes{{{jvmSel}},area="heap"}) / avg(jvm_memory_max_bytes{{{jvmSel}},area="heap"}) * 100',
        ],
        'dbpool_active' => [
            'label'       => 'DB Pool % used (Hikari)',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'Active DB connections รวมทั้ง workload / pool max. ' .
                             '90 = pool ใกล้เต็ม, thread ต่อไปจะรอ connection → latency spike. ' .
                             'ใช้จับ DB bottleneck ก่อนเกิด timeout',
            'suggested'   => 90,
            'aggregation' => 'sum ข้าม pods / max pool',
            'unit'        => 'reqs',
            'source'      => 'jvm',
            'compareAs'   => 'pct',
            'liveQuery'   => 'sum(hikaricp_connections_active{{{jvmSel}}})',
            'limitQuery'  => 'max(hikaricp_connections_max{{{jvmSel}}})',
        ],
        'error_rate' => [
            'label'       => 'HTTP 5xx error rate %',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'จำนวน 5xx / total requests × 100. 1 = ยิงเมื่อ error rate เกิน 1%. ' .
                             'ทำงานเฉพาะ Spring Boot service ที่ expose Micrometer',
            'suggested'   => 1,
            'aggregation' => 'sum(5xx) / sum(all) × 100',
            'unit'        => 'pct',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'supportsUri' => true,
            'liveQuery'   => '(sum(rate(http_server_requests_seconds_count{{{jvmSel}},status=~"5.."}[5m])) / (sum(rate(http_server_requests_seconds_count{{{jvmSel}}}[5m])) > 0)) * 100',
        ],

        // ─── ABSOLUTE-VALUE metrics (threshold = raw units) ──────────────
        'latency' => [
            'label'       => 'Avg latency (ms) — workload เฉลี่ย',
            'groupLabel'  => 'Latency (threshold = milliseconds)',
            'description' => 'เวลาเฉลี่ยของ HTTP request ทั้ง service. ' .
                             '500 = ยิงเมื่อ avg เกิน 500ms. ' .
                             '⚠ ไม่จับ tail spike — request ช้าตัวเดียวถูก smooth ด้วย request เร็วอื่นๆ',
            'suggested'   => 500,
            'aggregation' => 'sum(rate _sum) / sum(rate _count) × 1000',
            'unit'        => 'ms',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'supportsUri' => true,
            'liveQuery'   => '(sum(rate(http_server_requests_seconds_sum{{{jvmSel}}}[5m])) / (sum(rate(http_server_requests_seconds_count{{{jvmSel}}}[5m])) > 0)) * 1000',
        ],
        'latency_max' => [
            'label'       => 'Latency MAX (ms) — request ที่ช้าที่สุด',
            'groupLabel'  => 'Latency (threshold = milliseconds)',
            'description' => 'ระยะเวลาของ request ที่ช้าที่สุดใน scrape interval ล่าสุด ' .
                             '(Micrometer <code>_max</code> gauge). ' .
                             '3000 = ยิงเมื่อมี request ค้างเกิน 3 วิ. ' .
                             '✅ ตัวเลือกที่ดีสำหรับจับ tail spike / SLO violations',
            'suggested'   => 3000,
            'aggregation' => 'max(http_server_requests_seconds_max) — worst request',
            'unit'        => 'ms',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'supportsUri' => true,
            'liveQuery'   => 'max(http_server_requests_seconds_max{{{jvmSel}}}) * 1000',
        ],
        'gc_pause' => [
            'label'       => 'GC pause max (ms)',
            'groupLabel'  => 'Latency (threshold = milliseconds)',
            'description' => 'ระยะเวลา stop-the-world GC ที่ยาวที่สุด (worst pod). ' .
                             '500 = ยิงเมื่อ GC pause > 500ms (คน user รู้สึกได้). ' .
                             'ใช้จับ heap pressure / GC tuning issues',
            'suggested'   => 500,
            'aggregation' => 'max(jvm_gc_pause_seconds_max) — worst pod worst pause',
            'unit'        => 'ms',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'max(jvm_gc_pause_seconds_max{{{jvmSel}}}) * 1000',
        ],

        // ─── COUNT / RATE metrics ────────────────────────────────────────
        'txn_rate' => [
            'label'       => 'TXN rate (req/s) — throughput',
            'groupLabel'  => 'Counts / rates',
            'description' => 'จำนวน HTTP request ต่อวินาที รวมทั้ง workload. ' .
                             'ใช้จับ traffic spike ผิดปกติ (attack?) หรือ traffic drop (upstream broken?). ' .
                             'ใช้ operator > สำหรับ spike, < สำหรับ drop',
            'suggested'   => 1000,
            'aggregation' => 'sum(rate(count[5m])) — total throughput',
            'unit'        => 'reqs',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'supportsUri' => true,
            'liveQuery'   => 'sum(rate(http_server_requests_seconds_count{{{jvmSel}}}[5m]))',
        ],
        'restarts' => [
            'label'       => 'Pod restarts (last 5m)',
            'groupLabel'  => 'Counts / rates',
            'description' => 'จำนวนครั้งที่ pod ถูก restart ใน 5 นาทีย้อนหลัง รวมทุก pod ใน workload. ' .
                             '1 = ยิงทันทีที่มี pod ตายและถูก recreate. ' .
                             'ใช้จับ crash loop / OOM / eviction',
            'suggested'   => 1,
            'aggregation' => 'sum ข้าม pods (workload total)',
            'unit'        => 'reqs',
            'source'      => 'kube',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(increase(kube_pod_container_status_restarts_total{{{sel}},{{contSel}}}[5m]))',
        ],
        'oom_killed' => [
            'label'       => 'OOMKilled pods (any pod in workload)',
            'groupLabel'  => 'Counts / rates',
            'description' => 'จำนวน pod ที่ terminated ด้วยสาเหตุ OOMKilled รวมทุก pod ใน workload. ' .
                             '1 = ยิงทันทีเมื่อมี pod โดน OOMKill แม้แต่ตัวเดียว. ' .
                             'ใช้ควบคู่กับ mem_pod_max (warning ก่อน) — ตัวนี้คือ evidence หลังเกิดเหตุ. ' .
                             'สำหรับ workload ที่ยัง restart อยู่เรื่อยๆ ค่าจะคงที่ที่ 1 ไม่รีเซตเป็น 0 จนกว่าจะ redeploy',
            'suggested'   => 1,
            'aggregation' => 'sum ข้าม pods (any pod with reason=OOMKilled)',
            'unit'        => 'reqs',
            'source'      => 'kube',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(kube_pod_container_status_last_terminated_reason{{{sel}},{{contSel}},reason="OOMKilled"})',
        ],

        // ══════════════════════════════════════════════════════════════
        // Alerts+ Phase 1: HIGH-VALUE additions (incident-frequency high)
        // ══════════════════════════════════════════════════════════════
        'cpu_throttled' => [
            'label'       => 'CPU throttled % — silent perf killer',
            'groupLabel'  => 'Kubernetes / capacity (threshold = %)',
            'description' => '% ของ CFS scheduler periods ที่ container ชน CPU limit และโดน throttle. ' .
                             'สำคัญ: CPU chart อาจแสดง headroom (60%) แต่ยังโดน throttle → latency พุ่งโดยไม่มี CPU spike ให้เห็น. ' .
                             '5 = warn (ต้องดู limit), 25 = critical (pod หิว CPU มาก)',
            'suggested'   => 5,
            'aggregation' => 'sum(rate(throttled_periods)) / sum(rate(periods)) × 100',
            'unit'        => 'pct',
            'source'      => 'kube',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(rate(container_cpu_cfs_throttled_periods_total{{{sel}},{{contSel}}}[5m])) / sum(rate(container_cpu_cfs_periods_total{{{sel}},{{contSel}}}[5m])) * 100',
        ],
        'http_pool_pending' => [
            'label'       => 'HTTP Client Pool pending (queue depth)',
            'groupLabel'  => 'HTTP Client / Downstream (threshold = count)',
            'description' => 'Apache HttpComponents connection pool มี request รอ connection กี่ตัว. ' .
                             '> 0 = pool หมดแล้ว มี waiter, ≥ 10 = downstream ตันหนัก / pool size เล็กไป. ' .
                             'Leading indicator ก่อน user เจอ timeout',
            'suggested'   => 1,
            'aggregation' => 'sum ข้าม pods + pools',
            'unit'        => 'reqs',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(httpcomponents_httpclient_pool_total_pending{{{jvmSel}}})',
        ],
        'http_pool_util' => [
            'label'       => 'HTTP Client Pool util %',
            'groupLabel'  => 'HTTP Client / Downstream (threshold = %)',
            'description' => 'Connection ที่ยืมใช้อยู่ / max capacity × 100. ' .
                             '70 = warn (เริ่มตึง), 90 = critical (pending กำลังจะขึ้น). ' .
                             'ตัวเลือกสำหรับ early warning ก่อน http_pool_pending จะขึ้น',
            'suggested'   => 90,
            'aggregation' => 'sum(leased) / sum(max_per_pod_per_pool) × 100',
            'unit'        => 'pct',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(httpcomponents_httpclient_pool_total_connections{{{jvmSel}},state="leased"}) / sum(max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{{{jvmSel}}})) * 100',
        ],
        'cb_open' => [
            'label'       => 'Circuit breakers OPEN (count)',
            'groupLabel'  => 'HTTP Client / Downstream (threshold = count)',
            'description' => 'จำนวน Resilience4j breaker ที่อยู่ในสถานะ OPEN หรือ FORCED_OPEN. ' .
                             '1 = ยิงทันทีเมื่อมี breaker แม้แต่ตัวเดียวเปิด. ' .
                             'ตรง = downstream ตาย, user เจอ fail-fast (ไม่รอ timeout)',
            'suggested'   => 1,
            'aggregation' => 'count(breakers with state ∈ {open, forced_open})',
            'unit'        => 'reqs',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'count(max by (name) (resilience4j_circuitbreaker_state{{{jvmSel}},state=~"open|forced_open"} == 1))',
        ],
        'latency_p95' => [
            'label'       => 'Latency p95 (ms) — SLO-friendly',
            'groupLabel'  => 'Latency (threshold = milliseconds)',
            'description' => '95% ของ request เสร็จภายในเวลานี้ (histogram_quantile). ' .
                             'มาตรฐาน SLO ทีมส่วนมากใช้ p95 หรือ p99 ไม่ใช่ avg. ' .
                             '500 warn, 1000 crit. ต้อง service export histogram buckets (~28 services เท่านั้น)',
            'suggested'   => 500,
            'aggregation' => 'histogram_quantile(0.95, ...) — 95th percentile',
            'unit'        => 'ms',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'supportsUri' => true,
            'liveQuery'   => 'histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{{{jvmSel}}}[5m]))) * 1000',
        ],
        'dbpool_pending' => [
            'label'       => 'DB Pool pending (thread รอ conn)',
            'groupLabel'  => 'DB Pool (Hikari) (threshold = count)',
            'description' => 'จำนวน thread ที่ขอ DB connection แต่ pool หมด ต้องรอ. ' .
                             '> 0 = pool ตัน user จะเห็น latency spike แน่นอน. ' .
                             'ตรง กว่าดู dbpool_active (%) เพราะ 100% util ยังไม่ pending ก็ยังไม่ user-visible',
            'suggested'   => 1,
            'aggregation' => 'sum ข้าม pods',
            'unit'        => 'reqs',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(hikaricp_connections_pending{{{jvmSel}}})',
        ],

        // ══════════════════════════════════════════════════════════════
        // Alerts+ Phase 2: expansion (coverage เต็ม)
        // ══════════════════════════════════════════════════════════════
        'hpa_max' => [
            'label'       => 'HPA capped at max replicas',
            'groupLabel'  => 'Kubernetes / capacity (threshold = %)',
            'description' => 'current_replicas / max_replicas × 100. ' .
                             '≥ 100 = HPA scale เต็มเพดาน แต่ยังอยากเพิ่ม (user จะช้า). ' .
                             '80 = warn (ใกล้เพดาน ควรเพิ่ม max). ' .
                             'ต้องมี HPA object ตั้งไว้ (~110 HPA ในระบบ)',
            'suggested'   => 100,
            'aggregation' => 'current / max × 100 (per HPA name)',
            'unit'        => 'pct',
            'source'      => 'kube',
            'compareAs'   => 'abs',
            'liveQuery'   => 'max(kube_horizontalpodautoscaler_status_current_replicas{horizontalpodautoscaler=~"(acm-)?{{svc}}"} / kube_horizontalpodautoscaler_spec_max_replicas{horizontalpodautoscaler=~"(acm-)?{{svc}}"}) * 100',
        ],
        'thread_blocked' => [
            'label'       => 'JVM Threads BLOCKED (lock contention)',
            'groupLabel'  => 'JVM Runtime (threshold = count)',
            'description' => 'จำนวน thread ที่อยู่ใน state BLOCKED (รอ monitor lock). ' .
                             '≥ 5 = lock contention likely — latency พุ่งโดย CPU ต่ำ (thread นั่งรอ). ' .
                             'มองหา synchronized ผิดที่ / DB row lock / shared mutable state',
            'suggested'   => 5,
            'aggregation' => 'sum(jvm_threads_states_threads{state="blocked"})',
            'unit'        => 'reqs',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(jvm_threads_states_threads{{{jvmSel}},state="blocked"})',
        ],
        'downstream_error' => [
            'label'       => 'Downstream (client) error rate %',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => '% ของ outbound calls (RestTemplate/Feign/WebClient) ที่ได้ 5xx / 4xx. ' .
                             'ต่างจาก error_rate (ที่วัด HTTP request เข้า) — ตัวนี้วัด HTTP call ออก. ' .
                             '1 = ยิงเมื่อ downstream fail rate เกิน 1%',
            'suggested'   => 1,
            'aggregation' => 'sum(rate(client 4xx+5xx)) / sum(rate(client all)) × 100',
            'unit'        => 'pct',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => '(sum(rate(http_client_requests_seconds_count{{{jvmSel}},status=~"[45].."}[5m])) / (sum(rate(http_client_requests_seconds_count{{{jvmSel}}}[5m])) > 0)) * 100',
        ],
        'tomcat_busy' => [
            'label'       => 'Tomcat threads busy %',
            'groupLabel'  => '% ของ limit (threshold = 0-100)',
            'description' => 'Tomcat worker threads ที่กำลังจัดการ request / max threads. ' .
                             '80 = warn (thread pool ตึง), 95 = critical (ใหม่จะรอ acceptCount). ' .
                             'ใช้จับ blocked-in-app scenarios (external call ช้า → thread ค้าง)',
            'suggested'   => 90,
            'aggregation' => 'max(busy) / max(config) × 100',
            'unit'        => 'pct',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => '(max(tomcat_threads_busy_threads{{{jvmSel}}} or Tomcat_ThreadPool_currentThreadsBusy{{{jvmSel}}}) / max(tomcat_threads_config_max_threads{{{jvmSel}}} or Tomcat_ThreadPool_maxThreads{{{jvmSel}}})) * 100',
        ],
        'fd_pct' => [
            'label'       => 'File descriptors % of limit',
            'groupLabel'  => 'JVM Runtime (threshold = %)',
            'description' => 'Open FDs / max FDs × 100. ' .
                             '80 = warn (FD leak likely), 95 = critical (จะเจอ "too many open files"). ' .
                             'ใช้จับ resource leak (unclosed streams / sockets)',
            'suggested'   => 80,
            'aggregation' => 'max(open) / max(max) × 100',
            'unit'        => 'pct',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => '(max(process_files_open_files{{{jvmSel}}} or process_files_open{{{jvmSel}}}) / max(process_files_max_files{{{jvmSel}}} or process_files_max{{{jvmSel}}})) * 100',
        ],
        'gc_freq' => [
            'label'       => 'GC frequency (pauses/sec)',
            'groupLabel'  => 'Counts / rates',
            'description' => 'จำนวน GC pause ต่อวินาที (rolling 5m). ' .
                             '0.5 = warn (GC ถี่ผิดปกติ = heap pressure), 2 = critical (GC storm). ' .
                             'ต่างจาก gc_pause (ยาว) — ตัวนี้จับ "GC เยอะจนกินเวลารวมกันเยอะ"',
            'suggested'   => 0.5,
            'aggregation' => 'sum(rate(gc_pause_seconds_count[5m]))',
            'unit'        => 'reqs',
            'source'      => 'jvm',
            'compareAs'   => 'abs',
            'liveQuery'   => 'sum(rate(jvm_gc_pause_seconds_count{{{jvmSel}}}[5m]))',
        ],
    ];
}

/**
 * Resolve which Grafana source (+ namespace + cluster) to query for a
 * service. Prefers the freshest detail.php cache; falls back to probing
 * each source via kube_pod_info. Shared by tick.php and preview.php.
 * Returns ['src' => ..., 'namespace' => ..., 'cluster' => ...] or null.
 */
function _alertsResolveSource(string $svc, string $preferCluster, array $sources): ?array {
    require_once __DIR__ . '/../service-performance/_lib.php';
    $svcSlug  = preg_replace('/[^a-z0-9._-]+/i', '_', $svc);
    $cacheDir = teamDataPath('service-performance/cache/detail');
    if (is_dir($cacheDir)) {
        $matches = glob($cacheDir . '/' . $svcSlug . '_*.json') ?: [];
        usort($matches, fn($a, $b) => filemtime($b) - filemtime($a));
        foreach ($matches as $f) {
            $data = json_decode((string)file_get_contents($f), true);
            if (!is_array($data) || empty($data['runway']['slug'])) continue;
            $slug = $data['runway']['slug'];
            $src  = null;
            foreach ($sources as $s) if (($s['slug'] ?? '') === $slug) { $src = $s; break; }
            if (!$src) continue;
            $cluster = (string)($data['selectedCluster'] ?? '');
            if ($preferCluster !== '' && $cluster !== $preferCluster) continue;
            return ['src' => $src, 'namespace' => (string)($data['namespace'] ?? ''), 'cluster' => $cluster];
        }
    }
    // Fallback: probe each source with kube_pod_info
    $svcRe = _spPromEscape($svc);
    foreach ($sources as $src) {
        try {
            $sel = "pod=~\"{$svcRe}.*\"";
            if (!empty($src['namespaceRegex'])) $sel .= ",namespace=~\"{$src['namespaceRegex']}\"";
            if (!empty($src['cluster']))        $sel .= ",cluster=~\"{$src['cluster']}\"";
            $res = spQueryPromQL($src, ['p' => "kube_pod_info{{$sel}}"]);
            if (empty($res['p'])) continue;
            $row = $res['p'][0]['metric'] ?? [];
            $ns  = (string)($row['namespace'] ?? '');
            $cl  = (string)($row['cluster']   ?? '');
            if ($preferCluster !== '' && $cl !== $preferCluster) continue;
            return ['src' => $src, 'namespace' => $ns, 'cluster' => $cl];
        } catch (Throwable $e) { continue; }
    }
    return null;
}

function alertsLoadRules(): array {
    $rules = readJson(ALERTS_RULES_FILE);
    return is_array($rules) ? $rules : [];
}
function alertsSaveRules(array $rules): void {
    writeJson(ALERTS_RULES_FILE, array_values($rules));
}
function alertsLoadState(): array {
    $state = readJson(ALERTS_STATE_FILE);
    return is_array($state) ? $state : [];
}
function alertsSaveState(array $state): void {
    writeJson(ALERTS_STATE_FILE, $state);
}
function alertsLoadNotifyConfig(): array {
    $raw = readJson(ALERTS_NOTIFY_CFG_FILE);
    $cfg = !empty($raw) ? $raw : ['channels' => []];
    if (!is_array($cfg))              $cfg = ['channels' => []];
    if (!isset($cfg['channels']))     $cfg['channels'] = [];
    if (!is_array($cfg['channels'])) $cfg['channels'] = [];
    return $cfg;
}
function alertsSaveNotifyConfig(array $cfg): void {
    writeJson(ALERTS_NOTIFY_CFG_FILE, $cfg);
}

// Basic rule shape validator — rejects rules the eval engine can't run.
// Returns null on success or a Thai error string on failure.
function alertsValidateRule(array $r): ?string {
    $catalog = alertMetricsCatalog();
    if (empty($r['service']) || !is_string($r['service'])) return 'service ต้องระบุ';
    if (empty($r['metric']) || !isset($catalog[$r['metric']])) return 'metric ไม่ถูกต้อง';
    if (!in_array($r['op'] ?? '', ['>', '>=', '<', '<='], true)) return 'operator ต้องเป็น > >= < <=';
    if (!is_numeric($r['threshold'] ?? null)) return 'threshold ต้องเป็นตัวเลข';
    $dur = (int)($r['durationSec'] ?? 60);
    if ($dur < 30 || $dur > 3600) return 'durationSec ต้อง 30-3600 วินาที';
    // repeatIntervalSec: 0 = notify once per fire (default), N>0 = re-notify
    // every N seconds while firing. Cap at 24h to prevent typos becoming
    // silence periods forever.
    $rep = (int)($r['repeatIntervalSec'] ?? 0);
    if ($rep < 0 || $rep > 86400) return 'repeatIntervalSec ต้อง 0-86400 วินาที';
    return null;
}

// Generate a stable-looking short id for a new rule.
function alertsNewId(): string {
    return 'alrt_' . substr(bin2hex(random_bytes(6)), 0, 10);
}
