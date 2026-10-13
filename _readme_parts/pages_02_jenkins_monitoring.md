# Jenkins & Monitoring Pages — Data Source Map

> อ่านจาก HTML + JS source โดยตรง · Sep 2026

---

## jenkins-portal.html

**Role:** Any authenticated user — `requireTeamFeature($payload, 'jenkins-portal')` must pass (team config gate)  
**Layout render:** `Layout.render('jenkins-portal')`

**API calls:**
- `GET /api/jenkins-portal/` — โหลด config (tools, apps, stats, can_admin)
- `GET /api/jenkins-portal/?status=1` — live Jenkins job status poll
- `GET /api/jenkins-portal/?history=1` — build history
- `GET /api/jenkins-portal/?approvals=1` — pending approvals
- `GET /api/jenkins-portal/?users=1` — portal user list (admin)
- `GET /api/jenkins-portal/?action=status&tool_id=X&queue_id=Y` — poll triggered build
- `POST /api/jenkins-portal/` actions: `trigger`, `add_app`, `update_app`, `delete_app`, `create_user`, `update_user`, `reset_password`, `unlock_user`, `delete_user`, `clear_history`

**Data files read/written:**
- `data/{team}/jenkins-portal-tools.json` — tool definitions
- `data/{team}/jenkins-portal-apps.json` — app catalog
- `data/{team}/jenkins-portal-history.json` — build history (max 200)
- `data/{team}/jenkins-portal-sessions.json` — login sessions
- `data/{team}/jenkins-portal-logs.json` — raw logs
- `data/users.json` — user list + user CRUD (jp_role field added)
- `data/sm/jenkins_servers.json` (SM-shared) — Jenkins server configs

**External:** Jenkins instances ผ่าน `jenkins-proxy` (hostCooldown circuit breaker)

---

## jenkins-build.html

**Role:** Any authenticated user — `requireTeamFeature($payload, 'jenkins-build')` must pass  
**Layout render:** `Layout.render('jenkins-build')`

**API calls:**
- `GET /api/jenkins-build/` — tools + server names + can_admin flag
- `GET /api/jenkins-build/?history=1` — build history
- `GET /api/jenkins-build/?approvals=1` — pending maker/checker approvals
- `GET /api/jenkins-build/?status=1&tool_id=X` — live status per tool
- `GET /api/jenkins-build/?action=status&tool_id=X&queue_id=Y` — poll queue/build
- `POST /api/jenkins-build/` actions: `submit` (trigger or queue), `approve`, `reject`

**Data files read/written:**
- `data/{team}/jenkins-build-tools.json` — tool definitions + param schema
- `data/{team}/jenkins-build-history.json` — build history (max 200 entries)
- `data/{team}/jenkins-build-approvals.json` — pending approvals
- `data/users.json` — user lookup (role: maker/checker/admin via `jb_role` field)
- `data/sm/jenkins_servers.json` (SM-shared) — Jenkins server configs

**External:** Jenkins instances ผ่าน `jenkins-proxy`  
**Build poll:** Queue item → `/queue/item/{id}/api/json` → build → `/job/.../api/json` (poll ทุก 3–5 วิ)

---

## so-jenkins.html

**Role:** Any authenticated user — `requireTeamFeature($payload, 'so-jenkins')` must pass  
**Layout render:** `Layout.render('so-jenkins')`

**API calls:**
- `GET /api/so-jenkins/` — config + tools
- `GET /api/so-jenkins/?status=1` — live job status
- `GET /api/so-jenkins/?history=1` — build history
- `GET /api/so-jenkins/?users=1` — portal users
- `GET /api/so-jenkins/?action=status&tool_id=X&queue_id=Y` — build poll
- `POST /api/so-jenkins/` actions: `trigger`, `update_user`, `reset_password`, `unlock_user`, `delete_user`, `clear_history`

**Data files read/written:**
- `data/{team}/so-jenkins-tools.json` — SO Jenkins tool definitions
- `data/{team}/so-jenkins-builds.json` — build history (max 200)
- `data/{team}/so-jenkins-logs.json` — raw logs
- `data/users.json` — user CRUD (soj_role field)
- `data/sm/jenkins_servers.json` (SM-shared)

**External:** Jenkins instances ผ่าน `jenkins-proxy`

---

## service-performance.html

**Role:** `ALL_STAFF_ROLES` (dev_user เข้าได้, read-only)  
**Layout render:** `Layout.render('service-performance')`

**API calls:**
- `GET /api/service-performance/suggestions.php?q=&limit=20` — autocomplete จาก Service Inventory CSV
- `GET /api/service-performance/index.php?runway=all` — bulk overview (legacy/fallback)
- `GET /api/service-performance/detail.php?service=X&window=30[&runway=Y][&cluster=Z]` — single workload CPU/MEM/Pod
- `GET /api/service-performance/pods.php?runway=X&namespace=Y&service=Z` — per-pod breakdown
- `GET /api/service-performance/subsystems.php?service=X&runway=Y&sections=hikari,tomcat,jvm,txn,chips,httppool&window=30` — lazy subsystem tabs
- `GET /api/service-performance/deploys.php?service=X&window=720` — deploy events (annotations)
- `GET /api/service-performance/dep-drill.php?kind=upstream|downstream&caller=X&target=Y` — dependency URI breakdown
- `GET /api/service-performance/refresh.php?runway=X` — force cache refresh
- `GET /api/downstream-health/breakdown.php?service=X&range=1h` — outbound HTTP error breakdown
- `GET /api/downstream-health/timeseries.php?service=X&endpoint=Y&range=1h` — error timeseries
- `POST /api/opensearch-proxy/index.php?action=list-endpoints` — log viewer endpoint list
- `POST /api/opensearch-proxy/index.php?action=search` — search logs (Log Viewer modal)
- `POST /api/opensearch-proxy/index.php?action=trace` — correlation ID trace
- `POST /api/opensearch-proxy/index.php?action=deeplink` — Dashboards deep link URL
- `GET /api/opensearch-user-creds/index.php` — check if user has saved creds
- `POST /api/opensearch-user-creds/index.php` — save OpenSearch creds
- `GET /api/alerts/list.php?service=X` — custom alert rules for this service
- `GET /api/alerts/notify-config.php` — notification channel config
- `POST /api/alerts/save.php` — save alert rule
- `DELETE /api/alerts/delete.php` — delete alert rule
- `POST /api/alerts/test.php` — test alert rule
- `GET /api/alerts/preview.php?...` — preview alert trigger

**Data files read:**
- `data/sm/service-performance-sources.json` (SM-shared) — Grafana runway configs + cache TTL
- `data/sm/service-performance/cache/{slug}.json` — runway cache (60s TTL, atomic write via tmp rename)
- `data/sm/service-performance/cache/detail/{key}.json` — detail cache per workload
- `data/sm/service-inventory/inventory.csv` — Service Inventory CSV (filter + autocomplete)
- `data/sm/opensearch_config.json` (SM-shared) — OpenSearch endpoint config
- `data/sm/opensearch_user_creds.json` — per-user encrypted OpenSearch creds
- `data/{team}/alerts/` — custom alert rules per service
- `data/{team}/downstream-health.json` — downstream service configs

**External:**
- **Grafana Thanos (Prometheus):** `POST {grafanaUrl}/api/datasources/proxy/uid/{dsUid}/api/v1/query` — PromQL for CPU/MEM/Pod/Subsystems
- **Grafana Thanos (JVM datasource):** `POST .../uid/{jvmDsUid}/api/v1/query` — Hikari/Tomcat/JVM/Txn/HttpPool metrics
- **OpenSearch:** `POST {base_url}/{index}/_search` or Dashboards proxy — logs

**Key query params:**
- `service` — ชื่อ workload (regex safe)
- `runway` — slug ของ Grafana runway
- `window` — minutes (default 30, max 43200)
- `start` / `end` — unix seconds (absolute range, overrides window)
- `cluster` — pin ไป cluster เดียวเมื่อ runway ครอบหลาย cluster
- `sections` — comma-separated subsystem sections

---

## restart-analyzer.html

**Role:** `ALL_STAFF_ROLES`  
**Layout render:** `Layout.render('restart-analyzer')`

**API calls:**
- `GET /api/restart-analyzer/index.php?service=X&range=1h` — full forensic analysis
- `GET /api/restart-analyzer/index.php?service=X&start=T1&end=T2` — custom range
- `GET /api/restart-analyzer/pod-detail.php?pod=X&namespace=Y&restartedAt=T&window=600` — zoom-in per pod

**Data files read:**
- `data/sm/service-performance-sources.json` (SM-shared) — Grafana datasource config
- `data/sm/restart-analyzer/cache/ra3_{service}_{range}.json` — result cache (60s TTL)

**External:**
- **Grafana Thanos (k8s datasource):** ~30+ PromQL instant queries via `curl_multi` — kube-state-metrics + cadvisor (pod restarts, OOM, CrashLoop, CPU/MEM peaks, network errors, HPA, node age)
- **Grafana Thanos (JVM datasource):** Micrometer downstream HTTP error queries (Phase 6)

**Key query params:**
- `service` — required (regex `[a-z0-9._-]+`)
- `range` — `1h | 6h | 24h | 7d`
- `start` / `end` — unix seconds (absolute range)

**Bootstrap:** `?service=X&range=1h` ใน URL → page รัน analysis ทันทีเมื่อโหลด

---

## restart-monitor.html

**Role:** `ALL_STAFF_ROLES`  
**Layout render:** `Layout.render('restart-monitor')`

**API calls:**
- `GET /api/restart-monitor/index.php?action=runways` — runway list
- `GET /api/restart-monitor/index.php?action=list[&runway=X]` — daily restart list
- `GET /api/restart-monitor/index.php?action=detail&date=YYYY-MM-DD[&runway=X]` — detail for a day
- `GET /api/restart-monitor/index.php?action=raw-list[&runway=X]` — raw data list
- `GET /api/restart-monitor/index.php?action=raw-detail&date=YYYY-MM-DD[&runway=X]` — raw detail
- `GET /api/restart-monitor/index.php?action=...` (date + endpointPath variant for custom endpoint)
- `POST /api/restart-monitor/fetch.php[?runway=X]` — trigger fetch for a runway
- `GET /api/restart-monitor/monthly.php?action=months[&runway=X]` — available months
- `GET /api/restart-monitor/monthly.php?action=summary&month=YYYY-MM[&runway=X]` — monthly summary
- `GET /api/restart-monitor/monthly-recipients.php` — email recipients config
- `POST /api/restart-monitor/monthly-recipients.php` — save recipients `{to, cc}`
- `POST /api/restart-monitor/send-monthly.php` — send monthly report email

**Data files read/written:**
- `data/sm/grafana-runways.json` (SM-shared) — runway definitions
- `data/sm/grafana-monitoring/raw/{slug}/{date}.json` (SM-shared) — raw daily data per runway
- `data/sm/grafana-monitoring/daily/{slug}/{date}.json` (SM-shared) — processed daily aggregates

**External:** Grafana Thanos ผ่าน `fetch.php` → kube-state-metrics PromQL (same infra as restart-analyzer)  
**Webhook notifications:** Google Chat ผ่าน `_notify.php` (per-runway webhook in `data/sm/grafana-runways.json`)

---

## alert-monitor.html

**Role:** Any authenticated user (`requireAuth()` only)  
**Layout render:** `Layout.render('alert-monitor')`

**API calls:**
- `GET /api/alert-monitor/state.php` — current alert state
- `GET /api/alert-monitor/available-months.php` — months with data
- `GET /api/alert-monitor/stats.php?from=M&to=M&top=10` — aggregate stats + leaderboard
- `GET /api/alert-monitor/compare.php?a=M&b=M` — month-over-month comparison
- `POST /api/alert-monitor/sync.php[?mode=...]` — trigger sync from external source
- `GET /api/alert-monitor/config.php` — admin: config
- `PATCH /api/alert-monitor/config.php` — admin: save config

**Data files read/written:**
- `data/{team}/alert-monitor-state.json` — current alert state
- `data/{team}/alert-monitor-config.json` — JSM / external source config
- `data/{team}/alerts/{YYYY-MM}.json` — monthly alert records (directory)

**External:** JSM (Jira Service Management) via `_jsm_client.php` — sync alerts from JSM project

---

## grafana-alerts.html

**Role:** `ALL_STAFF_ROLES` + `requireTeamFeature($payload, 'grafana-alerts')`  
**Layout render:** `Layout.render('grafana-alerts')`

**API calls:**
- `GET /api/grafana-alerts/paused.php` — paused legacy alerts from all configured Grafana instances
- `POST /api/grafana-alerts/resume.php` — resume a paused alert `{slug, id}`

**Data files read:**
- `data/sm/grafana-alert-sources.json` (SM-shared) — Grafana instance configs (URL, auth, orgId)

**External:**
- **Grafana API (per source):** `GET {grafanaUrl}/api/alerts?state=paused` — auth: Bearer token (per-org) or Basic auth (`GRAFANA_BASIC_USER`/`GRAFANA_BASIC_PASS` env)
- **Grafana API (resume):** `POST {grafanaUrl}/api/alerts/{id}/pause` with `{"paused": false}`

---

## begin-grafana.html

**Role:** SM team only (`requireSmTeamOnly('Begin Grafana')`)  
**Layout render:** `Layout.render('begin-grafana')`

**API calls:**
- `GET /api/begin-grafana/endpoints.php?service=X[&window=30][&cluster=Y]` — HTTP endpoints discovery
- `GET /api/begin-grafana/series.php?service=X&method=POST&uri=/api/v1/pay&metric=rps[&window=30]` — time series per endpoint
- `GET /api/begin-grafana/promql.php?service=X&method=POST&uri=/api/v1/pay[&cluster=Y]` — ready-to-paste PromQL + Explore URL
- `GET /api/begin-grafana/custom-list.php?service=X` — custom business metrics (`<service>_*_total`)
- `GET /api/begin-grafana/custom-series.php?service=X&metric=Y&mode=success&window=30[&narrowSel=Z]` — custom metric time series

**Data files read:**
- `data/sm/service-performance-sources.json` (SM-shared) — Grafana datasource config (reuses SP lib)
- `data/sm/begin-grafana/cache/{key}.json` — endpoint cache (60s TTL)

**External:**
- **Grafana Thanos (Prometheus):** PromQL to discover HTTP server endpoints (`http_server_requests_seconds_*`), compute RPS/latency/p95/error rate
- Returns: endpoint list with health classification + ready-to-paste PromQL strings + Grafana Explore URL

---

## monitoring.html

**Role:** Any authenticated user  
**Layout render:** `Layout.render('monitoring')`

**API calls:**
- `GET /api/links/index.php?section=monitoring` — monitoring quick-links (Grafana dashboards, etc.)

**Data files read:**
- `data/{team}/links.json` (non-shared sections) — team's own links
- `data/sm/links.json` (SM-shared, `monitoring` section) — SM-managed monitoring links

**Notes:** หน้านี้เป็น tile wall แสดง Grafana/external dashboards เป็น iframe — link configs อยู่ใน `links.json` section `monitoring`  
**External:** Grafana dashboards, DataDog — embedded via `<iframe>` (no direct API call from browser)

---

## uptime.html

**Role:** Any authenticated user (write: ADMIN_ROLES)  
**Layout render:** `Layout.render('uptime')`

**API calls:**
- `GET /api/uptime/index.php` — list monitors + current statuses + SLA
- `GET /api/uptime/check.php` — trigger manual check of all monitors
- `GET /api/uptime/config.php` — admin: get config
- `POST /api/uptime/config.php` — admin: save config
- `POST /api/uptime/index.php` `{name, url}` — admin: add monitor
- `DELETE /api/uptime/index.php?id=X` — admin: remove monitor

**Data files read/written:**
- `data/{team}/uptime_monitors.json` — monitor definitions `{id, name, url, method, expected_status, interval_min, timeout_sec, enabled}`
- `data/{team}/uptime_history.json` — check history per monitor

**External:** HTTP probe ไปยัง `url` ของแต่ละ monitor (server-side, จาก `check.php`)

---

## compare.html

**Role:** Any authenticated user  
**Layout render:** `Layout.render('compare')`

**API calls:**
- `GET /api/service-performance/suggestions.php?q=&limit=500` — service name autocomplete (from CSV)
- `GET /api/service-performance/detail.php?service=X&window=W[&cluster=C]` — CPU/MEM/Pod for service A
- `GET /api/service-performance/detail.php?service=Y&window=W[&cluster=C]` — CPU/MEM/Pod for service B (parallel)

**Data files read:**
- `data/sm/service-performance-sources.json` (SM-shared) — Grafana runway configs
- `data/sm/service-inventory/inventory.csv` — service name autocomplete
- `data/sm/service-performance/cache/detail/{key}.json` — detail cache (60s TTL)

**External:** Grafana Thanos (Prometheus) — CPU/MEM/Pod PromQL สำหรับ 2 services แบบ side-by-side  
**URL sharing:** query string `?a=svc1&b=svc2&window=30` — page bootstrap from URL params

---

## log-explorer.html

**Role:** SM team only (API enforces `requireSmTeamOnly` on opensearch-proxy)  
**Layout render:** `Layout.render('log-explorer')`

**API calls:**
- `GET /api/opensearch-proxy/index.php?action=list-endpoints` — available OpenSearch endpoints
- `POST /api/opensearch-proxy/index.php?action=test-creds` — test creds `{endpoint_id, username, password}`
- `POST /api/opensearch-proxy/index.php?action=search` — search logs (DSL built server-side)
- `POST /api/opensearch-proxy/index.php?action=trace` — correlation ID trace
- `POST /api/opensearch-proxy/index.php?action=deeplink` — generate Dashboards Discover URL
- `GET /api/opensearch-user-creds/index.php` — list saved endpoints (no passwords)
- `POST /api/opensearch-user-creds/index.php` — save creds `{endpoint_id, username, password}`
- `DELETE /api/opensearch-user-creds/index.php?endpoint_id=X` — remove creds
- `GET /api/opensearch-saved-searches/index.php` — list saved searches
- `POST /api/opensearch-saved-searches/index.php` — save search
- `PUT /api/opensearch-saved-searches/index.php?id=X` — update saved search
- `DELETE /api/opensearch-saved-searches/index.php?id=X` — delete saved search
- `GET /api/opensearch-saved-folders/index.php` — list folders
- `POST /api/opensearch-saved-folders/index.php` — create folder
- `PUT /api/opensearch-saved-folders/index.php?id=X` — rename folder
- `DELETE /api/opensearch-saved-folders/index.php?id=X` — delete folder

**Data files read/written:**
- `data/sm/opensearch_config.json` (SM-shared) — endpoint configs (URL, auth, index patterns)
- `data/sm/opensearch_user_creds.json` — per-user AES-256-CBC encrypted credentials (keyed `[user_id][endpoint_id]`)
- `data/sm/opensearch_saved_searches.json` — team-shared saved searches
- `data/sm/opensearch_saved_folders.json` — folder groupings for saved searches
- `data/sm/opensearch_sessions.json` — Dashboards cookie session cache (30min TTL, `dashboards` auth mode)

**External:**
- **OpenSearch REST API:** `POST {base_url}/{index_pattern}/_search` (basic auth mode)
- **OpenSearch Dashboards proxy:** `POST {base_url}/internal/search/opensearch` (cookie session mode)
- Auth: per-user AES-256-CBC encrypted creds (key = `sha256(JWT_SECRET)`) — decrypted server-side only
- Circuit breaker: `hostCooldownActive()` / `hostCooldownMark()` on cURL errors

**2 main tabs:**
1. **Search Log** — search + histogram + trace
2. **Save By SM** — team-shared saved searches + folders (CRUD)
