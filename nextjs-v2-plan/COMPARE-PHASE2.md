# Phase 2 parity audit: v1 PHP portal vs v2 Next.js portal

Roots: v1 = /home/user/SOM-Portal, v2 = /home/user/SOM-Portal/som-portal-v2. Paths below are repo-relative to these roots.
Method: static read of v1 HTML/JS/PHP and v2 TSX/TS, grep-based line evidence. No test was run, no npm install, no repo file was modified.
Status key: DONE = implemented and wired end-to-end. PARTIAL = UI or API exists but a piece is missing, stubbed, or permission-divergent. MISSING = no v2 implementation.
v1 line numbers in JS/HTML are approximate where noted "~".

## Summary

| Tool | DONE | PARTIAL | MISSING |
|---|---|---|---|
| 1. MA Services | 9 | 6 | 6 |
| 2. MA Status | 4 | 7 | 3 |
| 3. Restart Monitor | 6 | 9 | 11 |
| 4. Restart Analyzer | 8 | 2 | 7 |
| 5. Service Performance | 6 | 7 | 10 |
| 6. Log Explorer | 13 | 4 | 8 |
| 7. Incident Launcher | 6 | 2 | 8 |
| 8. Mail (mail-config, send-email, mail-logs) | 4 | 3 | 3 |
| 9. Scheduled Notifications | 7 | 3 | 5 |

Cross-cutting findings (details in each section):
- v2 has no cron or scheduler. v1 daily Restart Monitor run (cron/restart-monitor-run-all.php) and v1 scheduled notifications (assets/js/noti-scheduler.js, browser-driven) have no v2 equivalent.
- Two v2 scheduled-notification handlers are placeholders that return fake success (som-portal-v2/src/scheduled-noti/runner.ts:78-96).
- Permission divergence: v1 gates writes on team=sm via requireSmForShared(); v2 uses role lists in several places (see items marked "permission gap").
- Dual-run data mismatch: v1 monthly recipients live in grafana-monitoring/monthly-recipients.json; v2 reads restart-monitor-recipients.json (som-portal-v2/app/api/restart-monitor/monthly-recipients/route.ts:13).
- v2 MA Status and Restart Monitor read caches written only by v1 code paths (no v2 poller).

---

## 1. MA Services

Files
- v1: ma-services.html; assets/pages/ma-services/{ma-services.js (2160 lines), ma-services-stats.js, ma-services-page.js}; api/ma-services/*.php (create, update, delete, list, types, import, jira-stats, backoffice-get/save/toggle, jenkins-params/trigger/status, log, logs-list); api/cutoff-services/*.php; api/ma-modules/config.php; import-ma.html (uses api/ma-services/import.php).
- v2: app/(app)/ma-services/{page.tsx, MAServicesClient.tsx}; app/api/v1/ma-services/{route.ts, [id]/route.ts, types/route.ts, jira-stats/route.ts, jenkins-trigger/route.ts, jenkins-status/route.ts, backoffice/route.ts}; src/ma/{services-store.ts, types-store.ts, jira-stats.ts, backoffice-client.ts, modules-store.ts, types.ts}.

Checklist
- [DONE] Search by name/remark/ID over services list (MAServicesClient.tsx:159).
- [DONE] Tool-type and service-type filters (MAServicesClient.tsx:166, :178).
- [DONE] Create service through dialog (button :140-142, ServiceFormDialog :287, POST app/api/v1/ma-services/route.ts:19).
- [DONE] Edit service (:242; PUT app/api/v1/ma-services/[id]/route.ts:12).
- [DONE] Delete with confirm (:70-71; DELETE [id]/route.ts:21).
- [DONE] Service-type dropdown from ma-types (types fetch :54; select :348-352).
- [DONE] Jenkins server/job, direct link, grafana link and can-change fields saved (form fields :381-430).
- [DONE] SM-only write gate on the server (src/ma/services-store.ts:19-20, enforced at :52, :99, :145). Parity test covers 403 for non-SM write (playwright/phase1-parity.spec.ts:118-126).
- [DONE] Activity log on create, update, delete (src/ma/services-store.ts:86, :132, :155).
- [PARTIAL] Read-only UI for non-SM teams. Server returns 403 but MAServicesClient.tsx shows add/edit/delete to everyone (no team check). v1 hides controls (assets/pages/ma-services/ma-services.js:82-96).
- [PARTIAL] Backoffice use-case link. Manual numeric input (ServiceFormDialog, ~:396). v1 has a searchable picker fed by ma-status tmn_backoffice (ma-services.js:1480-1660).
- [PARTIAL] Jira yearly stats (year select, domain split, pipeline, refresh). GET app/api/v1/ma-services/jira-stats/route.ts:10-18 reads a cache file only (src/ma/jira-stats.ts:8-10). No Jira fetch, no bypass-cache refresh, no stale fallback, no UI caller.
- [PARTIAL] Backoffice use-case read. GET app/api/v1/ma-services/backoffice/route.ts exists. No save route and no UI (v1 ma-services.js:1930-2160, backoffice-get/save.php).
- [PARTIAL] Jenkins build (params, trigger, status polling, 3s anti-double-click). jenkins-trigger/route.ts:18 and jenkins-status/route.ts:12 exist. MAServicesClient only calls list, types and [id].
- [PARTIAL] Backoffice enable/disable toggle. Only API exists at app/api/v1/ma-status/toggle/route.ts:20; not wired from this page (v1 ma-services.js:710-850).
- [MISSING] Landing module cards and module navigation (ma-modules). src/ma/modules-store.ts exists with no route or UI.
- [MISSING] Cut-off services tab (CRUD, bank filter, images). No cutoff routes or UI in v2.
- [MISSING] Image upload, gallery and lightbox per service. v2 only reads images as a string array type (MAServicesClient.tsx:21).
- [MISSING] Grafana popup from row link. grafana_link is form-only (:419).
- [MISSING] OpenSearch link per row. Not in table columns (:193-200).
- [MISSING] Import from import-ma.html (api/ma-services/import.php). No v2 route.

Tests
- src/ma/__tests__/services-store.test.ts (schema and store).
- playwright/phase1-parity.spec.ts:118-126 (non-SM read 200, write 403).
- No UI component test.

Real-data dependency
- data/sm/ma-services.json, ma-types.json, ma-modules.json, ma-services-jira-stats-YYYY.json (Jira-derived; produced only by v1 api/ma-services/jira-stats.php).
- Jenkins servers (jenkins_servers.json) and Admin Portal backoffice API (src/ma/backoffice-client.ts).
- Dev substitute: playwright/fixtures/build-data-copy.mjs builds a safe copy of v1 data. No MSW mock for Jenkins or backoffice exists (planned in nextjs-v2-plan/test_strategy.md:47-50, not present).

Future
- v1 custom-module placeholder ("no data backend yet", ma-services.js:337-352).
- v1 import flow (import-ma.html). Plan item P2-B (nextjs-v2-plan/HANDOFF.md:50).

---

## 2. MA Status

Files
- v1: ma-status.html; assets/pages/ma-status/ma-status.js (475 lines); admin/ma-status.html; assets/pages/admin/ma-status/ma-status.js; api/ma-status/{index.php (630 lines), hidden.php, jenkins-jobs.php, mapping.php, _backoffice.php, _lib.php}.
- v2: app/(app)/ma-status/{page.tsx, MAStatusDashboard.tsx}; app/api/v1/ma-status/{route.ts, hidden/route.ts, toggle/route.ts, jenkins-jobs/route.ts, mapping/route.ts}; src/ma/{status-poller.ts, backoffice-client.ts}.

Checklist
- [DONE] Status list read from shared cache (app/api/v1/ma-status/route.ts:10-22; src/ma/status-poller.ts readStatusCache).
- [DONE] Search by label, name, updater (MAStatusDashboard.tsx:127-129; filter :63-70).
- [DONE] Source filter (dropdown, MAStatusDashboard.tsx:134-139). Replaces v1 source tabs (ma-status.html:129-141).
- [DONE] User-hidden items excluded from results (src/ma/status-poller.ts filterItems; route.ts:16-17).
- [PARTIAL] Manual refresh. Button at MAStatusDashboard.tsx:108 re-reads cache only; v1 ?refresh=1 forces an upstream fetch (ma-status.js:~126).
- [PARTIAL] Auto-refresh every 30s. Always on (MAStatusDashboard.tsx:57-60). No on/off toggle (v1 ma-status.js:86-92).
- [PARTIAL] Live upstream fetch (NANO, Jenkins, features, backoffice). v2 has no fetchers. Freshness depends on v1 api/ma-status/index.php writing ma-status-cache.json (index.php:41-47), which only happens when a v1 request runs. No cron was found in v1.
- [PARTIAL] Admin Jenkins Jobs CRUD and reset-to-defaults. app/api/v1/ma-status/jenkins-jobs/route.ts GET:75, POST:89 (ADMIN_ROLES). No UI (v1 admin/ma-status.html:40-70).
- [PARTIAL] Backoffice mapping (link and unlink service to use case). app/api/v1/ma-status/mapping/route.ts GET:18, POST:34. No UI (v1 admin/ma-status.html:91-135).
- [PARTIAL] Hide items per source (save). app/api/v1/ma-status/hidden/route.ts GET:21, POST:34 (ADMIN_ROLES). No UI (v1 admin/ma-status.html:140-167).
- [PARTIAL] Toggle MA enable/disable with reason. app/api/v1/ma-status/toggle/route.ts:20-22 and src/ma/backoffice-client.ts:129. No UI. Permission gap: v1 backoffice-toggle.php:17 requireSmForShared(); v2 uses requireAuth only.
- [MISSING] Status filter chips (All, Closed, Open, Critical) with counts (v1 ma-status.html:155-158). v2 shows only open and normal counts (MAStatusDashboard.tsx:73-74).
- [MISSING] Discovery panel for unmapped backoffice items (v1 ma-status.js discovery block, ~:370-400).
- [MISSING] Admin page for MA Status (v1 admin/ma-status.html). No app/(admin)/admin/ma-status.

Permission gaps
- Mapping POST is role-only (ADMIN_ROLES) and writes via writeServicesFile (mapping/route.ts:60). v1 mapping.php:13 also requires requireSmForShared().

Tests
- src/ma/__tests__/services-store.test.ts imports filterItems and flattenStatusItems (unit coverage of filter only).
- No route or UI test; no test for toggle or hidden.

Real-data dependency
- data/sm/ma-status-cache.json written by v1 index.php. Upstreams: cdn-loan-product.ascendnano.com (index.php ~:67), NANO-internal Jenkins, TMN Jenkins, features (mobile-gateway), Admin Portal backoffice.
- Dev substitute: none in v2 beyond a copied data folder. MSW mocks planned (test_strategy.md) are absent.

Future
- v1 Jenkins job overrides with hardcoded defaults (admin ma-status "Reset to defaults").
- Plan P2-B (nextjs-v2-plan/HANDOFF.md:50).

---

## 3. Restart Monitor

Files
- v1: restart-monitor.html (473 lines); assets/pages/restart-monitor/restart-monitor.js (2877 lines, Chart.js from cdnjs); api/restart-monitor/{index.php, fetch.php, backfill.php, upload.php, monthly.php, monthly-recipients.php, preview-monthly.php, public-monthly.php, send-monthly.php, _fetch_lib.php, _notify.php, _email.php, _aggregate.php}; api/restart-monitor-webhooks/index.php; cron/restart-monitor-run-all.php, cron/restart-monitor-fetch.php, cron/backfill-history.php.
- v2: app/(app)/restart-monitor/{page.tsx, RestartMonitorClient.tsx (422 lines)}; app/api/restart-monitor/{route.ts, fetch/route.ts, backfill/route.ts, upload/route.ts, monthly/route.ts, monthly-recipients/route.ts, webhooks/route.ts}; src/restart-monitor/{service.ts, fetcher.ts, raw-store.ts, aggregator.ts, runways.ts, webhooks.ts, types.ts}.

Checklist
- [DONE] Runway tabs (EKS TMN, EKS NANO, OCP) (RestartMonitorClient.tsx:207-230).
- [DONE] Pod table with search, sort and pagination (:302, :308-324, :368-371).
- [DONE] Report history list with row click to select date (:387-416, :402).
- [DONE] Raw and analyzed data stored per slug and date (src/restart-monitor/raw-store.ts:11-15, writes raw and daily copies :54-59).
- [DONE] Prometheus instant queries via Grafana/Thanos (src/restart-monitor/fetcher.ts:77 instantBatch).
- [DONE] Read and list endpoints (app/api/restart-monitor/route.ts list, detail, raw-list, raw-detail, runways).
- [PARTIAL] Manual "Fetch from Prometheus" (button :245, POST fetch/route.ts:11-13). Works, but gate is role-only (ADMIN_ROLES). v1 fetch.php:28 requires requireSmForShared().
- [PARTIAL] Summary KPIs. Four tiles on detail only (:250-262). v1 shows restarts 7d, critical 7d, OOM 30d and days (restart-monitor.html:77-90).
- [PARTIAL] Raw tab. Raw API actions exist (route.ts:31, :62). No tab in UI (v1 restart-monitor.html:40-41, 168-262).
- [PARTIAL] Monthly report data. app/api/restart-monitor/monthly/route.ts GET aggregates exist. No UI caller (v1 monthly modal, restart-monitor.html:277-425).
- [PARTIAL] Monthly email send. POST monthly/route.ts:127-190 sends one runway with To only (no CC). v1 send-monthly.php sends a combined all-runway email with To and CC.
- [PARTIAL] Recipients (To and CC) editor. GET and POST exist (monthly-recipients/route.ts:15, :29), no UI. v1 stores to+cc (monthly-recipients.php:72) at a different path (see permission/data note).
- [PARTIAL] Webhook (Google Chat) config per runway. GET and POST exist (webhooks/route.ts:11, :25, ADMIN for POST), no UI.
- [PARTIAL] Backfill. POST backfill/route.ts:25 (ADMIN_ROLES), no UI. v1 has CLI backfill.php and cron/backfill-history.php.
- [PARTIAL] Upload of daily snapshot. JWT admin variant only (upload/route.ts:14). v1 upload.php is machine-to-machine with X-Restart-Monitor-Token.
- [MISSING] Day navigation (prev and next, day pills, sort) and day summary card (v1 restart-monitor.html:95-124).
- [MISSING] Period presets (month tabs, custom range) and aggregate versus day view (v1 :60-70, :143-145).
- [MISSING] Service grouping view and service filter combo (v1 :131-141; ~restart-monitor.js:1108 groupPodsByService).
- [MISSING] Per-pod detail view (v1 restart-monitor.js:1448-1477 showPodDetail).
- [MISSING] Trend and reason charts (v1 Chart.js, restart-monitor.js:2127-2175).
- [MISSING] Email preview (v1 preview-monthly.php; no v2 route).
- [MISSING] Public read-only monthly report page linked from email (v1 public-monthly.php; no v2 route).
- [MISSING] Daily scheduled run at 09:00 ICT (cron/restart-monitor-run-all.php). No cron or scheduler in v2; triggerFetch is manual only (src/restart-monitor/service.ts:88).
- [MISSING] Daily Chat and SMTP notification after fetch (v1 _notify.php, notify-history.json). src/restart-monitor/webhooks.ts:17 sendRestartWebhook has no callers.
- [MISSING] HPA scale timeline. Fetcher hardcodes hpaEvents: {} (src/restart-monitor/fetcher.ts:185); v1 runs a range query (_fetch_lib.php:264-276).
- [MISSING] Read-only view for non-SM teams (v1 restart-monitor.js:6-37 banner and hidden actions).

Tests
- None for restart-monitor (grep of src and playwright found no spec).

Real-data dependency
- Prometheus through Grafana/Thanos (grafana-runways.json, per-runway tokens from env, _fetch_lib.php:24-37). Google Chat webhooks (RESTART_MONITOR_CHAT_WEBHOOK_* env). SMTP (mail_config).
- Writes grafana-monitoring/raw and daily (both portals).
- Dev substitute: none for Prometheus. The v1 fixture copy only covers JSON state.

Future
- v1 daily run plus notification is the production path; v2 has nothing equivalent (see MISSING).
- nextjs-v2-plan/HANDOFF.md:51 lists this as Phase 2 C.

Data mismatch
- Recipients file: v1 grafana-monitoring/monthly-recipients.json vs v2 restart-monitor-recipients.json. Recipients saved in one portal are invisible to the other.

---

## 4. Restart Analyzer

Files
- v1: restart-analyzer.html (133 lines); assets/pages/restart-analyzer/restart-analyzer.js (1218 lines); api/restart-analyzer/{index.php (1035 lines, 60s cache), pod-detail.php}.
- v2: app/(app)/restart-analyzer/{page.tsx, RestartAnalyzerClient.tsx (373 lines)}; app/api/restart-analyzer/{route.ts, pod-detail/route.ts}; src/restart-analyzer/{analyzer.ts (338), pod-detail.ts (96), types.ts}.

Checklist
- [DONE] Service input with Enter to run (RestartAnalyzerClient.tsx:145-147).
- [DONE] Range presets 1h, 6h, 24h, 7d (:152-160; RANGES at :66).
- [DONE] Analyze button with loading state (:169).
- [DONE] Verdict banner (:182-194).
- [DONE] Root-cause candidates with score bars (:256-269; sort in src/restart-analyzer/analyzer.ts:302).
- [DONE] Affected pods table with click to pod detail (:277-300; loadPodDetail :112-130).
- [DONE] Phase 1 (restart trigger), Phase 2 (memory), Phase 3 (CPU throttling) as analysis steps (src/restart-analyzer/analyzer.ts:195-222; rendered :242-243).
- [DONE] Role gate ALL_STAFF (app/api/restart-analyzer/route.ts:30; pod-detail/route.ts:26).
- [PARTIAL] Phase 8 (HPA and deployment scale). Only the hpaScaleEvent candidate (analyzer.ts:170, :294-299); no dedicated step.
- [PARTIAL] Pod detail. Shows limits and point counts (:321-341), not the time-series charts v1 draws (restart-analyzer.js ~:1142).
- [MISSING] Phase 4 (network health), Phase 5 (K8s waiting reasons), Phase 6 (downstream Spring Boot health), Phase 7 (node placement), Phase 9 (post-restart recovery), Phase 10 (uptime-before-death and disk pressure). v1 defines all ten (restart-analyzer.js:414-531).
- [MISSING] Timeline chart. analyzer.ts:76-83 and :322 compute range data, but no UI renders it (v1 paintChart, restart-analyzer.js:33, :980).
- [MISSING] Custom date-range picker (v1 restart-analyzer.html:92-113).
- [MISSING] PromQL docs modal (v1 RA.openDocs, restart-analyzer.js:348+).
- [MISSING] URL deep link (?service=&range=) (v1 restart-analyzer.js:1209-1211).
- [MISSING] kubectl events hint (v1 restart-analyzer.js:710).
- [MISSING] 60s result cache (v1 index.php:87-91). v2 route has no cache.

Tests
- None for restart-analyzer (no spec or unit test in src or playwright).

Real-data dependency
- Grafana datasource proxy and Thanos for kube-state-metrics and cAdvisor series (analyzer.ts:58-83). Needs real cluster metrics; no dev substitute.

Future
- v1 Phase 4-10 are the target; v2 currently covers 1-3 plus HPA candidate.
- Plan P2-C (nextjs-v2-plan/HANDOFF.md:51).

---

## 5. Service Performance

Files
- v1: service-performance.html (404 lines); assets/pages/service-performance/service-performance.js (9512 lines; SP at :1450, LogViewer :6473, Alerts :7403, DeepAnalysis :8705, Compare :9198); api/service-performance/{index, detail, deploys, pods, subsystems, dep-drill, suggestions, refresh, _lib}.php; api/downstream-health/{services, breakdown, timeseries}.php; api/alerts/*.php; assets/js/noti-scheduler.js:1006 (alerts tick).
- v2: app/(app)/service-performance/{page.tsx, loading.tsx, _components/{CommandCenter.tsx (87), ServiceList.tsx (139), ServiceDetail.tsx (133), SidePanel.tsx (151), ResourceBar.tsx}}; app/api/service-performance/{route.ts, detail/route.ts, refresh/route.ts, suggestions/route.ts, dep-drill/route.ts, deploys/route.ts, pods/route.ts, subsystems/route.ts}; src/service-performance/{service.ts, thanos-client.ts, cache.ts, sources.ts, queries.ts, promql.ts, schema.ts, escape.ts}.

Checklist
- [DONE] Command Center overview: runway tabs and service list (ServiceList.tsx:47-56, :110-129).
- [DONE] Service filter text box (ServiceList.tsx:73-76).
- [DONE] Live overview from Thanos with cache TTL (service.ts:241, cache read :229-234; CommandCenter.tsx:34).
- [DONE] Auto-refresh with visibility pause (CommandCenter.tsx:23-40).
- [DONE] Service summary tiles (pods, CPU, MEM) and bars (ServiceDetail.tsx:60-98).
- [DONE] Sheet link to inventory (SidePanel.tsx:135-145).
- [PARTIAL] Detail sections API (dependencies, endpoints, outbound, per-pod). app/api/service-performance/detail/route.ts exists; no UI caller. ServiceDetail.tsx header says chart placeholder; SidePanel.tsx says dependency placeholder.
- [PARTIAL] Deploys timeline. deploys/route.ts; no UI (v1 service-performance.js ~:2342).
- [PARTIAL] Subsystem tabs (DB pool, Tomcat, JVM runtime, transaction). subsystems/route.ts; no UI (v1 ~:2567-2650).
- [PARTIAL] Per-pod table. pods/route.ts; no UI.
- [PARTIAL] Search-first suggestions. suggestions/route.ts; no UI (v1 service-performance.js:1481-1492).
- [PARTIAL] Dependency drill-down per node. dep-drill/route.ts; no UI (v1 ~:4135).
- [PARTIAL] Manual refresh. refresh/route.ts POST; no button (v1 refresh flow).
- [MISSING] CPU and memory time-series charts (v1 ~:4536). ServiceDetail.tsx header says placeholder.
- [MISSING] Transaction rate and latency, health chips, JVM and Tomcat detail (v1 ~:4552-4727).
- [MISSING] Time window presets and custom picker, cluster selector (v1 service-performance.html:134-155).
- [MISSING] Docs modal (v1 html:115).
- [MISSING] Compare services with shareable URL (v1 CM at js:9198; html:375-385).
- [MISSING] Deep analysis modal (v1 DA at js:8705; html:356-367).
- [MISSING] Alerts drawer: rule list, add, preview, test, Google Chat channels (v1 html:279-349; api/alerts/*; no v2 alerts routes).
- [MISSING] Alerts background tick every 30s from open browsers (v1 noti-scheduler.js:1006; api/alerts/tick.php).
- [MISSING] Log viewer launched from a service (v1 LogViewer at js:6473; html:193-256). Only the separate Log Explorer page exists in v2.
- [MISSING] Downstream health breakdown and timeseries (v1 api/downstream-health/*). No v2 routes.

Tests
- src/service-performance/__tests__/escape.test.ts (escape helper only). No overview or detail test.

Real-data dependency
- Thanos through Grafana datasource proxy (sources.ts, thanos-client.ts). service-performance-sources.json and service-inventory data (Google Sheet). Needs live Prometheus; no dev substitute.

Future
- Plan P2-A (nextjs-v2-plan/HANDOFF.md:49). Plan docs note research/promql-tag.md.

---

## 6. Log Explorer

Files
- v1: log-explorer.html (455 lines); assets/pages/log-explorer/log-explorer.js (1666 lines); api/opensearch-proxy/index.php (845 lines, requireSmTeamOnly), api/opensearch-config, api/opensearch-user-creds, api/opensearch-saved-searches (delete restricted to creator or admin/lead, index.php:4), api/opensearch-saved-folders.
- v2: app/(app)/log-explorer/{page.tsx, LogExplorerClient.tsx (852 lines), loading.tsx}; app/api/opensearch/{proxy/route.ts, config, user-creds, saved-searches, saved-folders}; src/opensearch/{client.ts, creds.ts, dsl.ts, endpoints.ts, normalize.ts, saved-searches.ts, schema.ts, sessions.ts}.

Checklist
- [DONE] Endpoint select (LogExplorerClient.tsx:450-453).
- [DONE] Index pattern input (:458-460).
- [DONE] Range presets 5m to 7d (RANGES :77-87; buttons :466-471).
- [DONE] Module, level, free-text query, regexp and correlation-id inputs (:482, :489, :500, :507, :513).
- [DONE] Search (doSearch :218).
- [DONE] Trace by correlation id (doTrace :257-300; button ~:526).
- [DONE] Histogram stacked by level (:569).
- [DONE] Hits table with row expand (:607, :656).
- [DONE] Page size and prev or next (:685-700).
- [DONE] Per-user credentials: status, set, test, save, clear (saveCreds :302, clearCreds :343, status :428-436, modal :716).
- [DONE] Saved searches: save current, load, delete (saveSearch :350, loadSavedSearch :377, deleteSaved :396, panel :766-767).
- [DONE] SM-team gate and super_viewer denied on proxy (src/opensearch/proxy/route.ts:15-16; all opensearch routes assertSmTeam).
- [DONE] Summary of error count (:561-563).
- [PARTIAL] Summary tiles (total, took, latency, status chips). Only error count shown; v1 shows total, took, 2xx, 4xx, 5xx, latency (log-explorer.html:136-144).
- [PARTIAL] Saved folders. Folder list is display-only (:789-799). Create, rename and delete APIs exist (saved-folders/route.ts POST:32, PUT:50, DELETE:72) with no UI.
- [PARTIAL] Save By SM tab. Saved-search panel exists (:766-830) but no separate tab, search box or counts (v1 log-explorer.html:86-87, :157-167).
- [DONE] Delete permission matches v1 code. Any SM member can delete a shared search (v1 index.php:235 comment says creator or admin only, but the code allows all SM members; v2 matches the code).
- [MISSING] Custom date range (v1 html:98-111). v2 offers presets only.
- [MISSING] CSV export (v1 log-explorer.js:1007-1016).
- [MISSING] Open in OpenSearch Dashboards (v1 log-explorer.js:1020). proxy deeplink action exists (proxy/route.ts:229) with no UI call.
- [MISSING] Copy shareable link and URL sync (v1 log-explorer.js:305-325, :428).
- [MISSING] Status chips 2xx, 4xx, 5xx as click filters (v1 html:139-143).
- [MISSING] Module facet include or exclude chips (v1 log-explorer.js:701-715).
- [MISSING] Saved-search history and activity view (v1 log-explorer.js:1059-1076; src/opensearch/saved-searches.ts:60 stores history but no UI).
- [MISSING] Long-form Save By SM log (history view) and folder rename or delete UI (covered by folder item above).

Tests
- src/opensearch/__tests__/creds.test.ts, dsl.test.ts, normalize.test.ts (backend helpers only). No UI test.

Real-data dependency
- OpenSearch cluster endpoints (opensearch_config.json) and per-user creds (opensearch_user_creds.json). No dev substitute; needs a reachable cluster.

Future
- Plan P2-D with research/opensearch-creds.md (nextjs-v2-plan/HANDOFF.md:52).

---

## 7. Incident Launcher

Files
- v1: incident-launcher.html (373 lines); assets/pages/incident-launcher/{incident-launcher.js (1998), wizard.js (2198), css}; test-incident-launcher.html (dev page, not counted); admin/incident-launcher-config.html (921 lines); api/incident-launcher/{index.php (567; actions config, save_config, notify_channel, webhook, bo_config_peek, bo_config_update, impact_summary, jira_*), impact.php}.
- v2: app/(app)/incident-launcher/{page.tsx, IncidentLauncherClient.tsx (856 lines)}; app/api/incident-launcher/{config, notify, bo/update, bo/peek, jira/issue, jira/transitions, jira/transition, jira/create-meta, impact}; src/incident-launcher/{channels.ts, webhook.ts, config-store.ts, backoffice-bridge.ts, jira-bridge.ts, impact-analyzer.ts, types.ts, webhook.test.ts}.

Checklist
- [DONE] Identify incident by Jira key (IncidentLauncherClient.tsx:112-130, fetch :121).
- [DONE] Investigate: list transitions and apply one (:131-175; fetch :137, :155).
- [DONE] MA toggle of backoffice config keys (:176-205; /bo/update :181).
- [DONE] Notify chosen channels (googlechat, dingtalk, line) (:206-234; /notify :216; channels.ts:33-79; SM gate notify/route.ts:17).
- [DONE] Summary and timeline (Step5Summary :783; addTimeline :100-107).
- [DONE] Load launcher config and SM-team gate (config fetch :93; config/route.ts:14).
- [PARTIAL] Impact summary. app/api/incident-launcher/impact/route.ts exists; no UI caller (v1 wizard.js:375-436, index.php impact_summary).
- [PARTIAL] Create Jira ticket and field metadata. jira/create-meta/route.ts exists; no create route or UI (v1 wizard.js:556-730, jira/create.php).
- [MISSING] Open War Room (Meet link posted to channels) (v1 wizard.js:246-318).
- [MISSING] Email partners (compose and send via mail/send) (v1 wizard.js:459-540; incident-launcher.js:232).
- [MISSING] Jenkins maintenance-job build (v1 wizard.js:1515-1721; jenkins-proxy build).
- [MISSING] MA timestamp log (v1 wizard.js:318).
- [MISSING] Service Performance embed (v1 wizard.js:340).
- [MISSING] Board post for incident (v1 incident-launcher.js:59).
- [MISSING] Escalation flow (fault start, confirm time, ticket key) (v1 incident-launcher.html:267-271; incident-launcher.js:1280-1324).
- [MISSING] Admin config editor: save_config, channels, MA jobs (v1 admin/incident-launcher-config.html; index.php save_config). v2 config is GET only.

Tests
- src/incident-launcher/webhook.test.ts (validateWebhookUrl, substituteTemplate).

Real-data dependency
- Jira (truemoney.atlassian.net, token from env), Google Chat, DingTalk and LINE webhooks, Admin Portal backoffice API, Jenkins. No dev substitute beyond the planned MSW mocks (absent).

Future
- v1 wizard has nine steps; v2 has five. Plan P2-E (nextjs-v2-plan/HANDOFF.md:53, "5-task multi-step flow"). nextjs-v2-plan/AUDIT-V1-VS-V2.md:408 flags admin/incident-launcher-config as inferred.

---

## 8. Mail (mail-config, send-email, mail-logs)

Files
- v1: admin/mail-config.html (542 lines) + assets/pages/admin/mail-config/mail-config.js (721); send-email.html (348) + assets/pages/send-email/send-email.js; admin/mail-logs.html (100); api/mail/{send.php, test-connection.php, test.php, logs.php, _mailer.php, _branding.php (427), _templates.php (489)}; api/mail-config/index.php (ADMIN_ROLES).
- v2: app/(admin)/admin/mail-config/{page.tsx, _components/MailConfigClient.tsx (359)}; app/api/mail/{config, test-connection, send-test, send, logs, templates}; src/mail/{mailer.ts, mail-config.ts, mail-admin.ts, logs.ts, templates.ts, branding.ts}.

Checklist
- [DONE] SMTP settings form: host, port, encryption, user, password (keep if blank), from name, from email (MailConfigClient.tsx:172-250; encryption select :196-204).
- [DONE] Save SMTP config (handleSave :70-104; POST/PUT /v2/api/mail/config :87; mail-admin.ts:44 ADMIN_ROLES).
- [DONE] Test connection with step results (handleTestConnection :106-117; UI :258-300).
- [DONE] Send test email (handleSendTest :120-140; input :273; button :280-284; send-test route).
- [PARTIAL] Mail logs. Table shows last 20 with total (fetchLogs :59-66; table :310-353). No search, status filter or pagination (v1 admin/mail-logs.html:52-81; mail-logs.js API.mail.getLogs).
- [PARTIAL] Compose and send email (v1 send-email.html:58-139: To and CC chips, subtype, service, subject, rich text, image; send at js:479). v2 has app/api/mail/send/route.ts (ADMIN_ROLES, route.ts:21) with no UI caller.
- [PARTIAL] Email templates. app/api/mail/templates exists with no UI.
- [MISSING] Global CC list editor. Field is in the payload only (MailConfigClient.tsx:83), no input (v1 admin/mail-config.html:132-140).
- [MISSING] Email signature editor. Payload only (MailConfigClient.tsx:84); no input (v1 mail-config.js:213).
- [MISSING] Branding: header and footer colors, presets, typewriter style, font sizes, theme lock (v1 admin/mail-config.html:150-380+). src/mail/branding.ts renders only.

Permission
- Gates match (v2 mail/config and logs use ADMIN_ROLES; v1 mail-config/index.php:14 and logs.php:4 use ADMIN_ROLES).
- v2 mail/send is ADMIN_ROLES with no SM team check; v1 send.php uses requireAuth only. Note the difference.

Tests
- None under src/mail or playwright.

Real-data dependency
- SMTP server (mail_config.json, mail_logs.json). Dev substitute: none in repo. nextjs-v2-plan/HANDOFF.md:54 plans Mailpit, not present.

Future
- Plan P2-F: SMTP via nodemailer with Mailpit mock (nextjs-v2-plan/HANDOFF.md:54). v2 uses its own mailer (src/mail/mailer.ts).

---

## 9. Scheduled Notifications

Files
- v1: admin/scheduled-noti.html (371 lines) + assets/pages/admin/scheduled-noti/scheduled-noti.js (747); api/scheduled-noti/{index.php (204), send-chat.php, send-grafana-paused.php, send-shift-summary.php}; assets/js/noti-scheduler.js (1094; browser scheduler polls config every 5 min, checks time every 30s).
- v2: app/(admin)/admin/scheduled-noti/{page.tsx, _components/ScheduledNotiClient.tsx (522)}; app/api/scheduled-noti/{route.ts, [id]/route.ts, [id]/run/route.ts}; src/scheduled-noti/{store.ts, runner.ts, types.ts}.

Checklist
- [DONE] List jobs (type, time, days, enabled, last run) (ScheduledNotiClient.tsx:81; GET route.ts:11-22).
- [DONE] Create and edit general job: message, action button, Google Chat webhook (form :333-367; create and update :129-132; store.ts:61, :95 requireRole ADMIN_ROLES).
- [DONE] Weekly day selection (:282-309).
- [DONE] Monthly day selection (:312-324).
- [DONE] Enable and disable toggle (:154-161).
- [DONE] Delete with confirm (:185-197; store.ts:132 requireRole).
- [DONE] Manual "run now" for a job (handleRun :167-181; run/route.ts:14; runner.ts:108 runJob).
- [PARTIAL] Shift-summary type. Type option exists (ScheduledNotiClient.tsx:64); no shift selectors (v1 scheduled-noti.js shift grid, admin html:222-290). Handler is a placeholder (runner.ts:90-96).
- [PARTIAL] Grafana paused-check type. Type option exists (:65); handler is a placeholder returning ok (runner.ts:78-84).
- [PARTIAL] Last-run status. Shown from stored fields, but runJob never persists last_run (runner.ts:118-125 comment says manual metadata, none written).
- [MISSING] Exclude-dates editor (v1 admin html:188-190). Field exists in schema and store (types.ts:18; store.ts:107) with no UI.
- [MISSING] Test send before save (v1 scheduled-noti.js:197-200, send-chat.php test flag).
- [MISSING] Automatic firing at scheduled time (v1 assets/js/noti-scheduler.js:31-80 runs in every open browser tab). v2 runJob is reachable only via the run route.
- [MISSING] Auto-notification section: Pod Restart Monitor per-runway webhook toggles (v1 admin html:100-112; scheduled-noti.js:250-291).
- [MISSING] Auto-notification section: Batch Monitor Noti per-server toggles (v1 admin html:114-130; scheduled-noti.js:303-343).

Permission
- v2 GET is open to any signed-in user; non-admins see filtered list (route.ts:13-18, isAdmin). Writes gated by requireRole in store.ts. v1 index.php:51 requires ADMIN_ROLES for the whole module.

Tests
- None under src/scheduled-noti or playwright.

Real-data dependency
- Google Chat incoming webhooks (sendChat, runner.ts:19-60). Grafana API for paused check (not implemented). Dev substitute: none; the chat URLs are per-job input.

Future
- v2 runner placeholders for grafana_paused and shift_summary (runner.ts:76-96). v1 implements both in send-grafana-paused.php and send-shift-summary.php.
- v1 automatic runner is browser-based, so reliability depends on an open tab. Decide whether v2 needs a server-side scheduler.

---

## Cross-check of Phase 2 status claims

- nextjs-v2-plan/PARITY-MATRIX.md:37 says Phase 2 is "Not started". The v2 tree already contains pages for all seven Phase 2 tools, so that note is stale.
- nextjs-v2-plan/PARITY-MATRIX.md:44 claims 4 failing Vitest tests in src/ma, src/opensearch, src/service-performance. Not verified here (tests not run).
