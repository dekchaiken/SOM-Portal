# Monitoring & Observability — Detailed API Spec

---

## 1. Service Performance (`api/service-performance/`)

### Tech Stack & Config

| Item | Value |
|------|-------|
| Language | PHP (procedural) |
| Metrics source | Grafana Thanos (Prometheus) via `/api/datasources/proxy/uid/<dsUid>/api/v1/query` |
| Auth (Grafana) | `basic` → `GRAFANA_BASIC_USER` / `GRAFANA_BASIC_PASS` from `.env`; `token` → per-source Bearer |
| Cache | File-based, 60s TTL per runway slug → `data/sm/service-performance/cache/<slug>.json` |
| Cache write | Atomic via temp-file + rename (`slug.json.tmp.<random>` → `slug.json`) |
| Cache sharing | SM-shared — one refresh benefits all teams |
| Memory limit | `ini_set('memory_limit', '512M')` — cold fill can OOM on thousands of Thanos series |
| Request timeout | `set_time_limit(180)` (index); `set_time_limit(60)` (subsystems) |
| Per-query timeout | `CURLOPT_TIMEOUT = 25s` (SP_QUERY_TIMEOUT) |
| Fatal shutdown fn | Converts PHP fatal errors to JSON `{success:false, message}` instead of empty 500 |
| Config file | `data/sm/service-performance-sources.json` (SM-shared) |

### Config Schema (`service-performance-sources.json`)

```json
{
  "cacheTtlSeconds": 60,
  "sheetEmbedUrl": "https://docs.google.com/...",
  "sheetOpenUrl": "https://docs.google.com/...",
  "serviceInventoryCsvPath": "data/sm/service-inventory/inventory.csv",
  "sources": [
    {
      "slug": "tmn-eks-prod",
      "name": "TMN EKS Production",
      "enabled": true,
      "grafanaUrl": "https://grafana.internal",
      "dsUid": "PROM_THANOS_UID",
      "jvmDsUid": "JVM_MICROMETER_UID",
      "orgId": 1,
      "authMode": "basic",
      "token": "",
      "color": "#3b82f6",
      "labelScheme": "k8s",
      "cluster": "acm-tmn-eks-prod",
      "namespaceRegex": "tmn-.+",
      "namespaceExclude": "tmn-infra",
      "podExclude": ".*-job-.*",
      "dashboardUid": "grafana-dashboard-uid"
    },
    {
      "slug": "acm-appscope",
      "labelScheme": "appScope",
      "envName": "prod",
      "appScope": ".+"
    }
  ]
}
```

**labelScheme** controls which PromQL queries are used:
- `k8s` — cadvisor + kube-state-metrics grouped by `(namespace, pod)`, aggregated PHP-side via `_spStripPodHash()`
- `appScope` — `up{env_name, appScope}` for ACM org=3

---

### GET /api/service-performance/index.php

**Auth:** any authenticated role (`ALL_STAFF_ROLES`)

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `runway` | string | `all` | Runway slug or `all` |
| `showAll` / `show_all` | bool | false | Include all pods (skip CSV inventory filter) |

**Response:**
```json
{
  "success": true,
  "runways": [
    {
      "slug": "tmn-eks-prod",
      "name": "TMN EKS Production",
      "orgId": 1,
      "color": "#3b82f6",
      "labelScheme": "k8s",
      "grafanaUrl": "https://grafana.internal",
      "dashboardUid": "uid",
      "fetchedAt": "2026-09-30T10:00:00+00:00",
      "fromCache": true,
      "_cacheAgeSeconds": 12,
      "services": [
        {
          "key": "default/payment-service",
          "service": "payment-service",
          "namespace": "default",
          "workloadType": "Deployment",
          "pods": 3,
          "cpuCores": 0.45,
          "cpuLimitCores": 2.0,
          "cpuPct": 22.5,
          "memBytes": 536870912,
          "memLimitBytes": 2147483648,
          "memPct": 25.0,
          "inventory": { "bu": "TH", "runway": "EKS", "team": "payment", ... }
        }
      ],
      "totals": { "services": 142, "pods": 430, "cpuHotspots": 3, "memHotspots": 5 },
      "error": null,
      "hasInventory": true
    }
  ],
  "sheetEmbedUrl": "...",
  "sheetOpenUrl": "...",
  "cacheTtlSeconds": 60,
  "hasInventory": true,
  "showAll": false,
  "unfilteredTotal": 210,
  "debug": {
    "inventoryEntries": 142,
    "inventoryPath": "/path/to/inventory.csv",
    "inventoryReadable": true,
    "filterActive": true
  }
}
```

**Hotspot thresholds:** `cpuPct >= 80` or `memPct >= 80`

---

### PromQL Queries — k8s label scheme (index/overview)

Grafana endpoint: `POST {grafanaUrl}/api/datasources/proxy/uid/{dsUid}/api/v1/query`
Request body: `query=<promql>&time=<unix_ts>`

```promql
# Active pods
kube_pod_info{cluster=~"<cluster>", namespace=~"<ns>", namespace!~"<nsExclude>", pod!~"<podExclude>"}

# CPU used (rate 5m window, per pod)
sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{<sel>, container!="", container!="POD"}[5m]))

# CPU limit per pod
sum by (namespace, pod) (kube_pod_container_resource_limits{<sel>, resource="cpu", container!=""})

# Memory used (working set) per pod
sum by (namespace, pod) (container_memory_working_set_bytes{<sel>, container!="", container!="POD"})

# Memory limit per pod
sum by (namespace, pod) (kube_pod_container_resource_limits{<sel>, resource="memory", container!=""})
```

**Pod-name → workload aggregation** is done PHP-side via `_spStripPodHash()`:
1. Deployment RS+pod: `^(.+)-[a-z0-9]{5,11}-[a-z0-9]{5}$`
2. CronJob→Job: `^(.+)-\d{8,13}-\d{1,6}$`
3. Job single: `^(.+)-\d{8,13}$`
4. DaemonSet: `^(.+)-[a-z0-9]{5}$`
5. StatefulSet: `^(.+)-\d{1,5}$`

**Regex escaping:** `_spPromEscape()` — escapes `.\\+*?[]()|\^$` but NOT `-` (Thanos rejects `\-`)

---

### PromQL Queries — appScope label scheme (ACM)

```promql
# Pod count
count by (appScope) (up{env_name="prod", appScope=~".+"} == 1)

# CPU used
sum by (appScope) (rate(container_cpu_usage_seconds_total{<sel>, container!="", container!="POD"}[5m]))

# CPU limit
sum by (appScope) (kube_pod_container_resource_limits{<sel>, resource="cpu", container!=""})

# Memory used
sum by (appScope) (container_memory_working_set_bytes{<sel>, container!="", container!="POD"})

# Memory limit
sum by (appScope) (kube_pod_container_resource_limits{<sel>, resource="memory", container!=""})
```

---

### PromQL Queries — Single Workload Detail (per pod)

Used by `pods.php` and `detail.php`. Selector: `cluster=~"<c>", namespace="<ns>", pod=~"<svc>.*", container="<svc>"`.

**Note:** `container="<service>"` targets main app container only (excludes istio-proxy). No `/2` needed.
**Rate window:** `[10m]` instead of `[5m]` — OCP Thanos scrape jitter is ~2–3 min; `[5m]` misses pods.

```promql
# Pods
kube_pod_info{cluster=~"<c>", namespace="<ns>", pod=~"<svc>.*"}

# CPU used (10m window)
avg by (namespace, pod) (rate(container_cpu_usage_seconds_total{<sel>}[10m]))

# CPU limit
avg by (namespace, pod) (kube_pod_container_resource_limits{<sel>, resource="cpu"})

# CPU request
avg by (namespace, pod) (kube_pod_container_resource_requests{<sel>, resource="cpu"})

# Memory used
avg by (namespace, pod) (container_memory_working_set_bytes{<sel>})

# Memory limit
avg by (namespace, pod) (kube_pod_container_resource_limits{<sel>, resource="memory"})

# Memory request
avg by (namespace, pod) (kube_pod_container_resource_requests{<sel>, resource="memory"})
```

---

### GET /api/service-performance/subsystems.php

**Auth:** `ALL_STAFF_ROLES`

**Query params:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | string | ✅ | Service name (regex: `[a-z0-9._-]+`) |
| `runway` | string | ✅ | Runway slug |
| `cluster` | string | | Cluster name (bypass auto-detect) |
| `sections` | string | ✅ | Comma-separated: `hikari,tomcat,jvm,txn,chips,httppool` |
| `window` | int | | Minutes (default 30, max 43200) |
| `start` | unix_ts | | Absolute range start (overrides `window`) |
| `end` | unix_ts | | Absolute range end |

**Grafana datasource:** `jvmDsUid` from source config (Micrometer/JVM datasource — separate from Thanos k8s dsUid)

**Selector format:** `app_name="<service>"[, cluster="<cluster>"]`

**Cache:** 60s per `(service, runway, cluster, sections, window)` key → `data/sm/service-performance/cache/subsystems/<key>.json`

---

#### Section: `hikari` (DB Connection Pool)

**Instant queries** (via `spQueryPromQL`):
```promql
sum(hikaricp_connections_active{app_name="<svc>"})
sum(hikaricp_connections_idle{app_name="<svc>"})
sum(hikaricp_connections_pending{app_name="<svc>"})
sum(hikaricp_connections{app_name="<svc>"})
max(hikaricp_connections_max{app_name="<svc>"})
max(hikaricp_connections_min{app_name="<svc>"})
sum(rate(hikaricp_connections_timeout_total{app_name="<svc>"}[5m]))
max(hikaricp_connections_acquire_seconds_max{app_name="<svc>"})
max(hikaricp_connections_usage_seconds_max{app_name="<svc>"})
max(hikaricp_connections_creation_seconds_max{app_name="<svc>"})
sum(rate(hikaricp_connections_usage_seconds_count{app_name="<svc>"}[5m]))
```

**Range queries** (via `spQueryPromRange`):
```promql
sum(hikaricp_connections_active{<sel>})           # active
sum(hikaricp_connections_idle{<sel>})             # idle
sum(hikaricp_connections_pending{<sel>})          # pending
sum(rate(hikaricp_connections_timeout_total{<sel>}[5m]))   # timeout rate
max(hikaricp_connections_acquire_seconds_max{<sel>}) * 1000  # acquireMaxMs
max(hikaricp_connections_usage_seconds_max{<sel>}) * 1000    # usageMaxMs
max(hikaricp_connections_active{<sel>})           # activeMax (per-pod envelope)
min(hikaricp_connections_active{<sel>})           # activeMin
max(hikaricp_connections_idle{<sel>})             # idleMax
min(hikaricp_connections_idle{<sel>})             # idleMin
max(hikaricp_connections_pending{<sel>})          # pendingMax
min(hikaricp_connections_pending{<sel>})          # pendingMin
max(rate(hikaricp_connections_timeout_total{<sel>}[5m]))  # timeoutMax
min(rate(hikaricp_connections_timeout_total{<sel>}[5m]))  # timeoutMin
min(hikaricp_connections_acquire_seconds_max{<sel>}) * 1000  # acquireMaxMin
min(hikaricp_connections_usage_seconds_max{<sel>}) * 1000    # usageMaxMin
```

**Response:**
```json
{
  "hikari": {
    "kpis": {
      "active": 5, "idle": 3, "pending": 0, "total": 8, "max": 10, "min": 2,
      "timeoutRate": 0.001, "acquireMaxMs": 12.5, "usageMaxMs": 45.2,
      "createMaxMs": 3.1, "usageRate": 8.3
    },
    "series": {
      "active":     [[ts, val], ...],
      "idle":       [[ts, val], ...],
      "pending":    [[ts, val], ...],
      "timeout":    [[ts, val], ...],
      "acquireMax": [[ts, val], ...],
      "usageMax":   [[ts, val], ...],
      "activeMax": [...], "activeMin": [...],
      "idleMax": [...], "idleMin": [...],
      "pendingMax": [...], "pendingMin": [...],
      "timeoutMax": [...], "timeoutMin": [...],
      "acquireMaxMin": [...], "usageMaxMin": [...]
    }
  }
}
```

---

#### Section: `tomcat` (Thread Pool)

Supports two label variants: `tomcat_threads_*` (Spring Boot ≥2.0 Micrometer) and `Tomcat_ThreadPool_*` (older JMX exporter).

**Instant queries:**
```promql
max(tomcat_threads_busy_threads{<sel>})
max(tomcat_threads_current_threads{<sel>})
max(tomcat_threads_config_max_threads{<sel>})
max(Tomcat_ThreadPool_currentThreadsBusy{<sel>})
max(Tomcat_ThreadPool_currentThreadCount{<sel>})
max(Tomcat_ThreadPool_maxThreads{<sel>})
max(Tomcat_ThreadPool_connectionCount{<sel>})
max(Tomcat_ThreadPool_maxConnections{<sel>})
max(Tomcat_ThreadPool_acceptCount{<sel>})
max(Tomcat_ThreadPool_keepAliveTimeout{<sel>})
max(Tomcat_ThreadPool_connectionTimeout{<sel>})
max(Tomcat_ThreadPool_minSpareThreads{<sel>})
```

**Range queries (with min/max envelopes):**
```promql
max(tomcat_threads_busy_threads{<sel>}) or max(Tomcat_ThreadPool_currentThreadsBusy{<sel>})
max(tomcat_threads_current_threads{<sel>}) or max(Tomcat_ThreadPool_currentThreadCount{<sel>})
max(Tomcat_ThreadPool_connectionCount{<sel>})
min(tomcat_threads_busy_threads{<sel>}) or min(Tomcat_ThreadPool_currentThreadsBusy{<sel>})
min(tomcat_threads_current_threads{<sel>}) or min(Tomcat_ThreadPool_currentThreadCount{<sel>})
min(Tomcat_ThreadPool_connectionCount{<sel>})
```

---

#### Section: `jvm` (Runtime / JVM)

**Instant queries:**
```promql
avg by (id, area) (jvm_memory_used_bytes{<sel>})
min by (id, area) (jvm_memory_max_bytes{<sel>})
max(jvm_threads_live_threads{<sel>}) or max(jvm_threads_current{<sel>})
max(jvm_threads_peak_threads{<sel>}) or max(jvm_threads_peak{<sel>})
max(jvm_threads_daemon_threads{<sel>}) or max(jvm_threads_daemon{<sel>})
sum by (state) (jvm_threads_states_threads{<sel>})            # BLOCKED/WAITING/RUNNABLE/etc.
max(jvm_classes_loaded_classes{<sel>})                        # classloader leak signal
sum by (id) (jvm_buffer_memory_used_bytes{<sel>})             # off-heap (Netty/NIO)
sum by (id) (jvm_buffer_count_buffers{<sel>})
avg(system_cpu_usage{<sel>})
avg(process_cpu_usage{<sel>})
avg(system_load_average_1m{<sel>})
max(process_files_open_files{<sel>}) or max(process_files_open{<sel>})
max(process_files_max_files{<sel>}) or max(process_files_max{<sel>})
max(jvm_gc_pause_seconds_max{<sel>})
sum(rate(jvm_gc_pause_seconds_sum{<sel>}[5m]))
sum(rate(jvm_gc_pause_seconds_count{<sel>}[5m]))
max(process_uptime_seconds{<sel>})
```

**Range queries (with per-pod envelopes):**
```promql
avg by (id) (jvm_memory_used_bytes{<sel>})
max(jvm_threads_live_threads{<sel>}) or max(jvm_threads_current{<sel>})
sum by (state) (jvm_threads_states_threads{<sel>})
max(jvm_classes_loaded_classes{<sel>})
sum by (id) (jvm_buffer_memory_used_bytes{<sel>})
avg(system_cpu_usage{<sel>}) * 100
avg(process_cpu_usage{<sel>}) * 100
avg(system_load_average_1m{<sel>})
max(jvm_gc_pause_seconds_max{<sel>}) * 1000
sum(rate(jvm_gc_pause_seconds_sum{<sel>}[5m])) * 1000
max(process_files_open_files{<sel>}) or max(process_files_open{<sel>})
# Min/max envelopes (sysCpu, procCpu, load1, gcPauseMax, filesOpen, threadsLive)
min/max variants of each above
```

**Response includes:**
- `pools[]` — JVM memory pool table (id, area, used, max, pct) — heap pools first, sorted by usage desc
- `buffers[]` — off-heap buffer pools (direct + mapped NIO buffers)
- `threads` — live, peak, daemon, `byState: {runnable, blocked, waiting, timed_waiting, ...}`
- `classesLoaded`, `system`, `files`, `gc`, `uptimeSec`
- `series.*` — time series for all above

---

#### Section: `txn` (Transaction Peaks)

Uses `max_over_time` across the window — not time-series, just peak KPIs.

```promql
max_over_time(sum(rate(http_server_requests_seconds_count{<sel>}[1m]))[<winStr>:15s])   # peakTps
max_over_time(sum(rate(http_client_requests_seconds_count{<sel>}[1m]))[<winStr>:15s])  # peakClientTps
max_over_time(max(http_server_requests_seconds_max{<sel>})[<winStr>:15s]) * 1000        # latMaxMs
max_over_time(max(http_client_requests_seconds_max{<sel>})[<winStr>:15s]) * 1000        # clientRtMaxMs
max_over_time(max(hikaricp_connections_active{<sel>})[<winStr>:15s])                    # peakDbActive
max_over_time(max(hikaricp_connections{<sel>})[<winStr>:15s])                           # peakDbTotal
max(hikaricp_connections_max{<sel>})                                                     # maxDb
max(hikaricp_connections_min{<sel>})                                                     # minDb
max_over_time(max(rate(hikaricp_connections_usage_seconds_count{<sel>}[1m]))[<winStr>:15s])  # peakDbUsage QPS
max_over_time(max(tomcat_threads_busy_threads{<sel>} or Tomcat_ThreadPool_currentThreadsBusy{<sel>})[<winStr>:15s])  # peakTcThread
max_over_time(max(Tomcat_ThreadPool_connectionCount{<sel>})[<winStr>:15s])              # peakTcConn
max_over_time(max(jvm_threads_live_threads{<sel>} or jvm_threads_current{<sel>})[<winStr>:15s])  # peakThreads
max_over_time((avg(jvm_memory_used_bytes{<sel>,area="heap"}) / avg(jvm_memory_max_bytes{<sel>,area="heap"}) * 100)[<winStr>:15s])  # peakHeapPct
```

---

#### Section: `httppool` (Apache HttpComponents Client Pool)

For services using Apache HC (many Spring Boot apps use it for outbound HTTP).

**Instant queries:**
```promql
sum(httpcomponents_httpclient_pool_total_connections{<sel>, state="leased"})
sum(httpcomponents_httpclient_pool_total_connections{<sel>, state="available"})
sum(httpcomponents_httpclient_pool_total_pending{<sel>})
sum(max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{<sel>}))  # fleet capacity
avg(httpcomponents_httpclient_pool_route_max_default{<sel>})
# Per-pool breakdown by httpclient bean name
sum by (httpclient) (httpcomponents_httpclient_pool_total_connections{<sel>, state="leased"})
sum by (httpclient) (httpcomponents_httpclient_pool_total_connections{<sel>, state="available"})
sum by (httpclient) (httpcomponents_httpclient_pool_total_pending{<sel>})
sum by (httpclient) (max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{<sel>}))
```

Returns `null` if `max` metric is not present (service doesn't expose pool metrics — frontend hides section).

---

#### Section: `chips` (Health Summary Chips)

Fast summary for the Command Center chip row. All instant queries.

```promql
sum(hikaricp_connections_active{<sel>})
max(hikaricp_connections_max{<sel>})
sum(hikaricp_connections_pending{<sel>})
sum(rate(hikaricp_connections_timeout_total{<sel>}[5m]))
max(tomcat_threads_busy_threads{<sel>} or Tomcat_ThreadPool_currentThreadsBusy{<sel>})
max(tomcat_threads_config_max_threads{<sel>} or Tomcat_ThreadPool_maxThreads{<sel>})
max(jvm_gc_pause_seconds_max{<sel>}) * 1000
sum(rate(jvm_gc_pause_seconds_count{<sel>}[5m]))
max(jvm_threads_live_threads{<sel>} or jvm_threads_current{<sel>})
avg(jvm_memory_used_bytes{<sel>,area="heap"}) / avg(jvm_memory_max_bytes{<sel>,area="heap"}) * 100
```

**State thresholds:**

| Chip | hot | warn | ok |
|------|-----|------|----|
| dbPool | timeout>0.05 OR pending>0 OR ratio≥0.9 | timeout>0 OR ratio≥0.7 | else |
| tomcat | ratio≥0.9 | ratio≥0.7 | else |
| gc | pauseMaxMs≥500 | pauseMaxMs≥100 | else |
| threads | live≥500 | — | else |
| heap | pct≥85 | pct≥70 | else |

---

### GET /api/service-performance/detail.php

*Drills into a single service across all runways. Uses `_spQueriesK8sForWorkload()` per-pod queries.*

### GET /api/service-performance/pods.php

*Returns per-pod CPU/MEM for one workload. Uses `spFetchWorkloadPods()`.*

### GET /api/service-performance/dep-drill.php

*Dependency graph — downstream HTTP client metrics via Micrometer `http_client_requests_*`.*

---

## 2. Service Inventory (`api/service-inventory/`)

### GET /api/service-inventory/

**Auth:** any authenticated role

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `runway` | string | Filter by Runway column (case-insensitive) |
| `action` | string | `meta` — return only file metadata (no rows) |

**Data file:** `serviceInventoryCsvPath` from `service-performance-sources.json` (configurable)

**CSV columns parsed:**
`Service name`, `BU`, `Runway`, `App Language`, `Service Group`, `Team Owner`, `Route Zone`, `Context Path`, `Arch`, `App Port`, `Timezone`, `CPU Limit`, `CPU Request`, `App Startup Args`, `Pipeline Version`, `Sonarqube`, `App Workload Type`, `Middleware Image`, `SpringNative Enable`, `Replicas (prod)`, `Cloudflare Proxy Enable`, `URL Production`, `Tester Tool`, `Severity Level`, `Datadog Enable`, `Application Git Repo URL`

**POST /api/service-inventory/** — Upload new CSV (admin only, `sm_admin`)  
Creates backup with timestamp before overwriting.

---

## 3. Restart Analyzer (`api/restart-analyzer/`)

### Tech Stack

| Item | Value |
|------|-------|
| Memory limit | `ini_set('memory_limit', '384M')` |
| Timeout | `set_time_limit(90)` |
| Cache | 60s TTL → `data/sm/restart-analyzer/cache/ra3_<service>_<range>.json` |
| Grafana endpoint | `spQueryPromQL()` + `spQueryPromRange()` (same infrastructure as SP) |
| Data source | Same `dsUid` as service-performance; `jvmDsUid` for Micrometer phase |

### GET /api/restart-analyzer/index.php

**Auth:** `ALL_STAFF_ROLES`

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `service` | string | — | ✅ Required. Regex `[a-z0-9._-]+` |
| `range` | string | `1h` | `1h` / `6h` / `24h` / `7d` |
| `start` | unix_ts | | Custom range start (overrides `range`) |
| `end` | unix_ts | | Custom range end |

**Pod regex:** `<_spPromEscape(service)>.*`

#### Phase 1–5 Instant Queries (kube-state + cadvisor)

Fired in parallel via `curl_multi_init()`:

```promql
# Trigger — total restarts in window
sum(increase(kube_pod_container_status_restarts_total{pod=~"<svc>.*"}[<range>]))

# Per-pod restart count (only pods with >0 restarts)
sum by (pod, namespace) (increase(kube_pod_container_status_restarts_total{pod=~"<svc>.*"}[<range>])) > 0

# Last-terminated exit reason per pod
sum by (pod, reason) (kube_pod_container_status_last_terminated_reason{pod=~"<svc>.*"} > 0)

# Container restart time (when did it last restart)
container_start_time_seconds{pod=~"<svc>.*", container!="POD", container!=""}

# Pod start time (for age calculation)
kube_pod_start_time{pod=~"<svc>.*"}

# Pod node placement
kube_pod_info{pod=~"<svc>.*"}

# Memory peak in window
max(max_over_time(container_memory_working_set_bytes{pod=~"<svc>.*", container!="POD", container!=""}[<range>])) by (pod)

# Memory limit per pod
max(kube_pod_container_resource_limits{pod=~"<svc>.*", resource="memory"}) by (pod)

# CPU peak % of limit
max(max_over_time(rate(container_cpu_usage_seconds_total{pod=~"<svc>.*", container!="POD", container!=""}[2m])[<range>:2m])) by (pod)
/ on(pod) group_left max(kube_pod_container_resource_limits{pod=~"<svc>.*", resource="cpu"}) by (pod) * 100

# CPU throttling (seconds + percent of CFS periods)
sum(increase(container_cpu_cfs_throttled_seconds_total{pod=~"<svc>.*", container!="POD", container!=""}[<range>]))
sum(increase(container_cpu_cfs_throttled_periods_total{...}[<range>])) / sum(increase(container_cpu_cfs_periods_total{...}[<range>])) * 100

# Kernel memory allocation failures (pre-OOM signal)
sum(increase(container_memory_failures_total{pod=~"<svc>.*", container!="POD", container!=""}[<range>]))

# Network errors + drops
sum(increase(container_network_receive_errors_total{pod=~"<svc>.*"}[<range>]))
sum(increase(container_network_transmit_errors_total{pod=~"<svc>.*"}[<range>]))
sum(increase(container_network_receive_packets_dropped_total{pod=~"<svc>.*"}[<range>]))
sum(increase(container_network_transmit_packets_dropped_total{pod=~"<svc>.*"}[<range>]))

# K8s waiting reason (CrashLoopBackOff, ImagePullBackOff, etc.)
sum by (pod, reason) (kube_pod_container_status_waiting_reason{pod=~"<svc>.*"} > 0)

# Post-restart readiness
sum(kube_pod_status_ready{pod=~"<svc>.*", condition="true"} == 1)
sum(kube_pod_status_phase{pod=~"<svc>.*", phase="Running"})

# Disk write rate
sum(rate(container_fs_writes_bytes_total{pod=~"<svc>.*", container!="POD", container!=""}[5m]))

# HPA scale events
min(min_over_time(kube_deployment_status_replicas{deployment=~"<svc_esc>.*"}[<range>]))
max(max_over_time(kube_deployment_status_replicas{deployment=~"<svc_esc>.*"}[<range>]))

# Node age (fresh node = Karpenter churn signal)
min by (node) (time() - kube_node_created{})
```

#### Phase 6 Downstream Queries (Micrometer — `jvmDsUid` only if configured)

```promql
# Downstream 5xx (snake_case label variant)
topk(6, sum by (client_name, status) (rate(http_client_requests_seconds_count{app_name="<svc>", status=~"5.."}[<range>])) > 0)

# Downstream 5xx (camelCase label variant)
topk(6, sum by (clientName, status) (rate(http_client_requests_seconds_count{app_name="<svc>", status=~"5.."}[<range>])) > 0)

# Downstream latency (snake + camel variants)
topk(6, sum by (client_name) (rate(http_client_requests_seconds_sum{app_name="<svc>"}[<range>])) / (sum by (client_name) (rate(http_client_requests_seconds_count{...}[<range>])) > 0) * 1000)

# Self-served 5xx (what this service returns to callers)
topk(6, sum by (uri, status) (rate(http_server_requests_seconds_count{app_name="<svc>", status=~"5.."}[<range>])) > 0)

# JVM self-health snapshot
max(jvm_memory_used_bytes{app_name="<svc>", area="heap"}) / max(jvm_memory_max_bytes{app_name="<svc>", area="heap"}) * 100
max(jvm_threads_live_threads{app_name="<svc>"})
sum(increase(jvm_gc_pause_seconds_sum{app_name="<svc>"}[<range>]))
```

#### Phase 8 Timeline Queries (range)

```promql
# Memory % of limit (max across pods)
max(container_memory_working_set_bytes{pod=~"<svc>.*", container!="POD", container!=""}) by ()
/ on() group_left max(kube_pod_container_resource_limits{pod=~"<svc>.*", resource="memory"}) * 100

# CPU % of limit (max across pods)
max(rate(container_cpu_usage_seconds_total{pod=~"<svc>.*", container!="POD", container!=""}[2m])) by ()
/ on() group_left max(kube_pod_container_resource_limits{pod=~"<svc>.*", resource="cpu"}) * 100

# Restart rate per minute
sum(rate(kube_pod_container_status_restarts_total{pod=~"<svc>.*"}[5m])) * 60
```

**Step calculation:** `max(30, round(rangeSec / 120))` — ~120 points per chart

#### Verdict Classification

| Verdict | Primary condition |
|---------|------------------|
| `no-restart` | `affectedPods == 0` |
| `oom` | `OOMKilled > 0` |
| `app-crash` | `CrashLoopBackOff waiting` or `Error > Completed` |
| `hot-pod` | 1 pod ≥5 restarts + ≥50% share (optionally + self-5xx) |
| `internal-overload` | `selfErrRate ≥ 1/s` + memFailcnt ≥ 100k |
| `downstream-failure` | downstream 5xx ≥ 1/s + Completed reason + coordinated |
| `traffic-spike` | HPA scale event + self-5xx or CPU ≥ 80% |
| `external-sigterm` | Completed + all pods coordinated within 120s |
| `individual-restart` | Completed but spread out |
| `inconclusive` | fallback |

**Multi-hypothesis candidates (top-5 ranked by score 0–100):** `oom`, `hot-pod`, `internal-overload`, `traffic-spike`, `app-crash`, `downstream-failure`, `external-sigterm`, `node-event`, `cpu-starvation`

**Full response:** `restartCount`, `affectedPods[]`, `reasonCounts`, `primaryReason`, `coordSpanSec`, `memPeakPct`, `memFailcnt`, `cpuPeakPct`, `cpuThrottlePct`, `netTotals`, `waitingReasons`, `downstreamErrors[]`, `selfHttpErrors[]`, `appMetrics`, `timeline{mem,cpu,restarts}`, `cascade[]`, `finalVerdict`, `summary`, `candidates[]`, `evidence{}` (raw PromQL + samples per metric — "view all evidence" feature)

---

## 4. Restart Monitor (`api/restart-monitor/`)

Continuous monitoring via webhook — different from Restart Analyzer (which is on-demand forensics).

### GET /api/restart-monitor/index.php

Returns current restart state per service.

### POST /api/restart-monitor/fetch.php

Fetches fresh data from Grafana (same kube-state queries as restart-analyzer) and stores to `data/sm/restart-monitor.json`.

### Notification files:
- `_notify.php` — sends Google Chat webhook when restart threshold exceeded
- `_email.php` — sends email alerts
- `monthly.php` / `send-monthly.php` — monthly digest reports
- `upload.php` — bulk upload restart records

---

## 5. OpenSearch Proxy (`api/opensearch-proxy/`)

### Tech Stack

| Item | Value |
|------|-------|
| Auth (OpenSearch) | Per-user AES-256-CBC encrypted credentials (key = `sha256(JWT_SECRET)`) |
| Session (Dashboards mode) | Cookie-based session cache 30min TTL → `data/sm/opensearch_sessions.json` |
| Config file | `data/sm/opensearch_config.json` (SM-shared, admin-managed) |
| User creds file | `data/sm/opensearch_user_creds.json` |
| Circuit breaker | `hostCooldownActive()` / `hostCooldownMark()` on cURL errors/500s |
| Rate limit | 120 req/60s per user (`apiRateLimit($payload['sub'], 'opensearch')`) |
| Access | SM team only (`requireSmTeamOnly()`) |
| Query timeout | 20s (cURL), 30s (OpenSearch server-side `"timeout":"30s"`) |
| Max hits | Configurable up to 1000 (`defaults.max_size`), default 200 |

### POST /api/opensearch-proxy/?action=list-endpoints

No body required. Returns enabled endpoints (creds redacted).

**Response:**
```json
{
  "endpoints": [
    {
      "id": "tmn-os",
      "name": "TMN OpenSearch",
      "default_index_pattern": "tmn-app-*",
      "index_patterns": ["tmn-app-*", "tmn-payment-*"],
      "has_dashboards_url": true,
      "order": 1
    }
  ],
  "defaults": { "size": 200, "max_size": 1000, "default_time_range_min": 15 }
}
```

### POST /api/opensearch-proxy/?action=search

**Request body:**
```json
{
  "endpoint_id": "tmn-os",
  "index_pattern": "tmn-app-*",
  "module": "payment-service",
  "log_level": "ERROR",
  "correlation_id": "TMG-abc123",
  "q": "NullPointerException",
  "regexp_rest": "[4-5][0-9]{2}",
  "range": "last_1h",
  "start": "2026-09-30T09:00:00Z",
  "end": "2026-09-30T10:00:00Z",
  "size": 200,
  "from": 0
}
```

**Range presets:** `last_5m`, `last_15m`, `last_30m`, `last_1h`, `last_4h`, `last_12h`, `last_24h`, `last_3d`, `last_7d`

**Histogram interval auto-select:**
| Span | Interval |
|------|----------|
| ≤15m | 30s |
| ≤1h | 2m |
| ≤4h | 10m |
| ≤12h | 30m |
| ≤24h | 1h |
| ≤3d | 3h |
| ≤7d | 12h |

**DSL query built server-side (never accepts raw DSL from browser):**
```json
{
  "size": 200,
  "from": 0,
  "sort": [{"@timestamp": {"order": "desc"}}],
  "query": {
    "bool": {
      "filter": [
        {"range": {"@timestamp": {"gte": 1234567890000, "lte": 1234571490000, "format": "epoch_millis"}}},
        {"bool": {"should": [
          {"term": {"Module.keyword": "payment-service"}},
          {"term": {"Module": "payment-service"}}
        ], "minimum_should_match": 1}},
        {"bool": {"should": [
          {"term": {"Log_Level.keyword": "ERROR"}},
          {"term": {"Log_Level": "ERROR"}}
        ], "minimum_should_match": 1}}
      ],
      "must": [
        {"query_string": {"query": "NullPointerException", "default_field": "REST", "analyze_wildcard": true, "lenient": true}}
      ]
    }
  },
  "aggs": {
    "histogram": {
      "date_histogram": {
        "field": "@timestamp",
        "fixed_interval": "2m",
        "min_doc_count": 0,
        "extended_bounds": {"min": 1234567890000, "max": 1234571490000}
      },
      "aggs": {
        "by_level": {"terms": {"field": "Log_Level.keyword", "size": 6, "missing": "UNKNOWN"}}
      }
    },
    "top_pods": {"terms": {"field": "kubernetes.pod_name.keyword", "size": 10, "missing": ""}}
  },
  "track_total_hits": 10000,
  "timeout": "30s"
}
```

**OpenSearch REST URL:** `POST {base_url}/{index_pattern}/_search` (Basic auth mode)  
**Dashboards proxy URL:** `POST {base_url}/internal/search/opensearch` (Cookie session mode)

**Response:**
```json
{
  "endpoint_id": "tmn-os",
  "index_pattern": "tmn-app-*",
  "time": {"gte": 1234567890000, "lte": 1234571490000, "interval": "2m"},
  "total": 842,
  "total_relation": "eq",
  "shards": {"total": 5, "successful": 5, "failed": 0, "skipped": 0, "timed_out": false},
  "returned": 200,
  "took_ms": 145,
  "summary": {
    "status": {"ok": 120, "warn": 42, "error": 38, "other": 0, "unknown": 0},
    "latency_avg": 234,
    "latency_max": 1890,
    "latency_n": 180
  },
  "histogram": [
    {"time": 1234567890000, "count": 45, "levels": [{"key": "ERROR", "count": 12}, {"key": "INFO", "count": 33}]}
  ],
  "top_correlations": [],
  "top_pods": [{"key": "payment-service-abc123-xyz99", "count": 120}],
  "hits": [
    {
      "id": "doc-id",
      "index": "tmn-app-2026.09",
      "timestamp": "2026-09-30T10:00:00.000Z",
      "module": "payment-service",
      "log_level": "ERROR",
      "correlation_id": "TMG-abc123",
      "rest": "status_code=[500] Response time=1376 ms ...",
      "status_code": 500,
      "latency_ms": 1376,
      "pod": "payment-service-abc123-xyz99",
      "namespace": "tmn-payment",
      "host": "10.0.1.5",
      "source": { "...full _source..." }
    }
  ]
}
```

**Special error response (no_user_creds):**
```json
{"ok": false, "message": "no_user_creds", "data": {"endpoint_id": "tmn-os"}}
```
HTTP 422 — frontend shows credential input prompt.

### POST /api/opensearch-proxy/?action=trace

**Request body:**
```json
{
  "endpoint_id": "tmn-os",
  "index_pattern": "tmn-app-*",
  "correlation_id": "TMG-abc123def456",
  "range": "last_1h",
  "size": 500
}
```

**DSL (cross-service, no Module filter):**
```json
{
  "size": 500,
  "sort": [{"@timestamp": {"order": "asc"}}],
  "query": {"bool": {"filter": [
    {"range": {"@timestamp": {"gte": ..., "lte": <lte + 90000>, "format": "epoch_millis"}}},
    {"bool": {"should": [
      {"term": {"CORRELATION_ID.keyword": "TMG-abc123def456"}},
      {"query_string": {"query": "\"TMG-abc123def456\"", "analyze_wildcard": true, "lenient": true, "default_operator": "AND"}}
    ], "minimum_should_match": 1}}
  ]}},
  "aggs": {
    "by_module": {"terms": {"field": "Module.keyword", "size": 20, "missing": "UNKNOWN"}}
  },
  "track_total_hits": 5000
}
```

Note: `lte` extended by 90s to absorb Fluentd shipping latency.

**Response:** `correlation_id`, `total`, `shards`, `returned`, `took_ms`, `modules[]`, `hits[]`

### POST /api/opensearch-proxy/?action=deeplink

Generates an OpenSearch Dashboards Discover URL. Returns `{"url": "https://..."}`.

### POST /api/opensearch-proxy/?action=test-creds

Tests user credentials against an endpoint without saving. Returns `{"latency_ms": 45, "mode": "basic", "status": "green"}`.

---

## 6. OpenSearch User Credentials (`api/opensearch-user-creds/`)

### GET /api/opensearch-user-creds/

Returns saved endpoints (without passwords) for the current user.

### POST /api/opensearch-user-creds/

**Request body:**
```json
{
  "endpoint_id": "tmn-os",
  "username": "john.doe",
  "password": "mysecret"
}
```

Encryption: AES-256-CBC, key = `hash('sha256', JWT_SECRET, true)`, random 16-byte IV prepended to ciphertext, base64-encoded.

**Data file:** `data/sm/opensearch_user_creds.json` (keyed: `[user_id][endpoint_id]`)

### DELETE /api/opensearch-user-creds/

Removes credentials for `endpoint_id`.

---

## 7. OpenSearch Config (`api/opensearch-config/`)

### GET /api/opensearch-config/

Returns endpoint list with credentials redacted (SM admin only for full write access).

### POST /api/opensearch-config/

Save/update endpoint config. Writes to `data/sm/opensearch_config.json` (SM-shared).

### Endpoint config schema:
```json
{
  "id": "tmn-os",
  "name": "TMN OpenSearch",
  "base_url": "https://opensearch.internal:9200",
  "dashboards_url": "https://opensearch-dash.internal",
  "username": "admin",
  "password": "...",
  "auth_mode": "basic",
  "osd_version": "2.7.0",
  "default_index_pattern": "tmn-app-*",
  "index_patterns": ["tmn-app-*", "tmn-payment-*"],
  "enabled": true,
  "order": 1
}
```

`auth_mode`: `basic` (REST API Basic Auth) or `dashboards` (cookie session via `/auth/login`)

### POST /api/opensearch-config/?action=test

Probes the endpoint with `GET /_cluster/health`. Returns `{latency_ms, status}`.

---

## 8. OpenSearch Saved Searches (`api/opensearch-saved-searches/`)

**Data file:** `data/sm/opensearch_saved_searches.json` (team-shared within SM)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/opensearch-saved-searches/` | List all saved searches (optional `?folder_id=`) |
| POST | `/api/opensearch-saved-searches/` | Create saved search |
| PUT | `/api/opensearch-saved-searches/?id=<id>` | Update |
| DELETE | `/api/opensearch-saved-searches/?id=<id>` | Delete |

**Schema:**
```json
{
  "id": "srch_01HX...",
  "name": "Payment ERROR logs",
  "endpoint_id": "tmn-os",
  "index_pattern": "tmn-app-*",
  "params": {
    "module": "payment-service",
    "log_level": "ERROR",
    "range": "last_1h"
  },
  "folder_id": "folder_01HX...",
  "created_by": "user-uuid",
  "created_at": "2026-09-30T10:00:00+07:00"
}
```

---

## 9. OpenSearch Saved Folders (`api/opensearch-saved-folders/`)

**Data file:** `data/sm/opensearch_saved_folders.json`

Standard CRUD (GET/POST/PUT/DELETE). Schema: `{id, name, color, created_by, created_at}`

---

## 10. Grafana Alerts (`api/grafana-alerts/`)

### GET /api/grafana-alerts/paused.php

Returns paused legacy alerts from all configured Grafana instances.

**Data file:** `data/sm/grafana-alert-sources.json`

**Auth (Grafana):**
- `authMode: token` → `Authorization: Bearer <token>` (per-org service-account token)
- `authMode: basic` (default) → `GRAFANA_BASIC_USER` / `GRAFANA_BASIC_PASS` from `.env` (cross-org credential)

**Grafana API called (parallel per source):**
```
GET {grafanaUrl}/api/alerts?state=paused
Headers: Authorization: Bearer|Basic ...
         X-Grafana-Org-Id: <orgId>
```

**Response:**
```json
{
  "total": 12,
  "sources": [
    {
      "name": "TMN Grafana",
      "slug": "tmn",
      "orgId": 1,
      "color": "#3b82f6",
      "grafanaUrl": "https://grafana.internal",
      "count": 8,
      "alerts": [
        {"id": 1, "name": "Payment latency", "state": "paused", "dashboardId": 12, "panelId": 5}
      ],
      "error": null
    }
  ],
  "fetched_at": "2026-09-30T10:00:00+07:00"
}
```

### POST /api/grafana-alerts/resume.php

Resume a specific paused alert: `{source_slug, alert_id}`

Calls: `POST {grafanaUrl}/api/alerts/{id}/pause` with `{"paused": false}`

---

## 11. Alert Monitor (`api/alert-monitor/`)

### GET /api/alert-monitor/config.php

Returns alert monitor config (admin only). Data: `data/sm/alert-monitor-config.json`

JSM (Jira Service Management) client: `_jsm_client.php` — used for incident sync.

### GET /api/alert-monitor/stats.php

Alert statistics: open count, acked count, silenced count.

### POST /api/alert-monitor/sync.php

Sync alerts from external source (configured endpoint).

---

## 12. Grafana Sources (`api/grafana-sources/`)

**Data file:** `data/sm/grafana-sources.json`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/grafana-sources/` | List configured Grafana iframe sources |
| POST | `/api/grafana-sources/` | Add source (sm_admin) |
| PUT | `/api/grafana-sources/?id=<id>` | Update source |
| DELETE | `/api/grafana-sources/?id=<id>` | Delete source |

Schema: `{id, name, url, category, iframe_height, order, enabled}`

---

## 13. Begin Grafana (`api/begin-grafana/`)

Spring/Micrometer endpoint discovery. SM-only. All use `_lib.php` + `spQueryPromQL()`.

### GET /api/begin-grafana/endpoints.php

**Query params:** `?service=<name>[&window=<min>][&cluster=<clu>]`

**PromQL queries fired:**
```promql
# Request rate per method+uri+status
sum by (method, uri, status) (rate(http_server_requests_seconds_count{<sel>}[<rangeSec>s]))

# Average latency per endpoint
1000 * sum by (method, uri) (rate(http_server_requests_seconds_sum{<sel>}[<rangeSec>s]))
     / sum by (method, uri) (rate(http_server_requests_seconds_count{<sel>}[<rangeSec>s]))

# Max latency
1000 * max by (method, uri) (http_server_requests_seconds_max{<sel>})

# p95 latency
1000 * histogram_quantile(0.95, sum by (method, uri, le) (rate(http_server_requests_seconds_bucket{<sel>}[<rangeSec>s])))
```

**Endpoint health classification:**
- `healthy` — error rate < 1% AND p95 < 1000ms
- `degraded` — error rate 1–5% OR p95 1–5s
- `failing` — error rate > 5% OR p95 > 5s
- `idle` — rps ~= 0

**Cache:** 60s per `(service, cluster, window)` key

**Response:**
```json
{
  "service": "payment-service",
  "found": true,
  "endpoints": [
    {
      "method": "POST", "uri": "/api/v1/pay",
      "rps": 42.3, "rate2xx": 41.8, "rate4xx": 0.3, "rate5xx": 0.1, "rateOther": 0.1,
      "errorPct": 0.95, "avgLatMs": 145, "p95LatMs": 280, "maxLatMs": 890,
      "health": "healthy"
    }
  ],
  "cluster": "acm-tmn-eks-prod",
  "appLabel": "app_name",
  "window": 30
}
```

### GET /api/begin-grafana/promql.php

**Query params:** `?service=<name>&uri=<uri>&method=<method>[&cluster=<clu>][&window=<min>]`

Returns ready-to-paste PromQL strings + Grafana Explore URL for one endpoint.

**Response:**
```json
{
  "service": "payment-service",
  "uri": "/api/v1/pay",
  "method": "POST",
  "queries": [
    {"label": "RPS",     "promql": "rate(http_server_requests_seconds_count{...}[1m])"},
    {"label": "p99 latency", "promql": "histogram_quantile(0.99, ...)"},
    {"label": "Error rate",  "promql": "rate(...{status=~\"5..\"}[1m]) / rate(...[1m]) * 100"}
  ],
  "explore_url": "https://grafana.internal/explore?orgId=1&left=..."
}
```

### GET /api/begin-grafana/series.php

Returns Prometheus series matching a service (auto-detect which datasource/labels are used).

### GET /api/begin-grafana/dep-drill.php

Downstream HTTP client dependency graph — uses `http_client_requests_*` metrics.

---

## 14. Uptime Monitor (`api/uptime/`)

### GET /api/uptime/

**Data file:** `data/<team>/uptime.json`

Returns endpoint statuses + SLA percentage.

### POST /api/uptime/ (sm_admin)

Add/update monitored endpoint.

Schema: `{id, name, url, method, expected_status, interval_min, timeout_sec, enabled}`

---

## 15. Downstream Health (`api/downstream-health/`)

### GET /api/downstream-health/

Returns health status of services this team depends on (configured list). Supports manual overrides for maintenance windows.

**Data file:** `data/<team>/downstream-health.json`

---

## Environment Variables Used

| Variable | Used in | Purpose |
|----------|---------|---------|
| `GRAFANA_BASIC_USER` | `service-performance/_lib.php`, `grafana-alerts/_fetch.php` | Cross-org Grafana basic auth username |
| `GRAFANA_BASIC_PASS` | Same | Cross-org Grafana basic auth password |
| `JWT_SECRET` | `opensearch-user-creds` (via `helpers.php`) | AES-256 key derivation for OS credential encryption |

Note: Grafana token per-source is stored in `data/sm/service-performance-sources.json` and `data/sm/grafana-alert-sources.json` (not in `.env`).
