# Brief P2-D — Log Explorer + OpenSearch Per-User Creds

You are a Feature Engineer building the **Log Explorer** module for SOM Portal v2 (Next.js 15 rewrite). Starting cold.

## Project layout

- v1 (PHP): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/`
- v2 (Next.js): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2/`

## Must read first

1. `som-portal-v2/nextjs-v2-plan/map.md` — Phase-0 decisions
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md` — patterns
3. `som-portal-v2/nextjs-v2-plan/domain_model.md` — roles, teams, access rules
4. `som-portal-v2/nextjs-v2-plan/HANDOFF.md` — resume checkpoint, JWT recipe, standing rules
5. **`som-portal-v2/nextjs-v2-plan/research/opensearch-creds.md`** — **CRITICAL**: AES-256-CBC crypto details, storage shape, DSL builder audit, proposed module shape
6. `som-portal-v2/nextjs-v2-plan/research/opensearch-creds.proposed.ts` — proposed v2 types
7. `api/opensearch-proxy/index.php` — main proxy: search, trace, deeplink, test-creds, list-endpoints
8. `api/opensearch-user-creds/index.php` — per-user credential CRUD (encrypt/decrypt)
9. `api/opensearch-config/index.php` — admin endpoint registry
10. `api/opensearch-saved-searches/index.php` — saved search presets (team-shared)
11. `api/opensearch-saved-folders/index.php` — folder tree for saved searches
12. `log-explorer.html` (455 lines) — v1 frontend
13. `data/sm/opensearch_config.json` — endpoint registry (base_url, auth_mode, default_index_pattern)
14. `data/sm/opensearch_user_creds.json` — encrypted per-user credentials
15. `data/sm/opensearch_sessions.json` — Dashboards session cookie cache
16. `data/sm/opensearch_saved_searches.json` — saved filters
17. `data/sm/opensearch_saved_folders.json` — folders

## Mission

Full Log Explorer matching v1 — search logs, trace correlation IDs, saved searches, per-user OpenSearch credentials.

### Service layer (`src/opensearch/`)

Follow the module shape from `research/opensearch-creds.md §5`:

- `creds.ts` — AES-256-CBC encrypt/decrypt, round-trips with v1 PHP blobs (key = sha256(JWT_SECRET), IV prepended, base64 envelope). CRUD: `loadUserCreds()`, `saveUserCreds()`, `deleteUserCreds()`, `listEndpointStatus()`. Return `null` not throw when no creds.
- `endpoints.ts` — read `opensearch_config.json`, list + validate endpoint_id
- `dsl.ts` — Zod schema for search params + `buildSearchDsl()` / `buildTraceDsl()` (port of v1 proxy's DSL builder). Allowed fields from `research/opensearch-creds.md §4`: endpoint_id, index_pattern, module, log_level, correlation_id, q, regexp_rest, range preset, start/end, size, from. Histogram auto-interval.
- `client.ts` — OpenSearchClient: basic auth mode (per-user creds) + Dashboards mode (session cookies). Session cache via `opensearch_sessions.json`.
- `sessions.ts` — Dashboards session cookie cache: key = `endpoint_id:user_id` (matches v1)
- `normalize.ts` — normalize hits for frontend display (port of `_osNormalizeHit`)
- `saved-searches.ts` — CRUD for saved search presets + folders (team-shared)

### Pages

- `app/(app)/log-explorer/page.tsx` — **Log Explorer**:
  - **Top bar**: endpoint selector dropdown, index pattern input (with autocomplete from config)
  - **Search form**:
    - Time range: preset buttons (5m, 15m, 30m, 1h, 4h, 12h, 24h, 3d, 7d) + custom date/time picker
    - Module filter (dropdown), Log level filter (multi-select: TRACE..FATAL)
    - Free text query (q), Regex on REST field (regexp_rest)
    - Correlation ID input (for trace mode)
    - Search button + Trace button
  - **Results area**:
    - Histogram chart: log volume over time, color-coded by log level
    - Top pods aggregation sidebar
    - Log entries table: timestamp, level (colored badge), module, REST, message (expandable to full JSON)
    - Pagination (size/from controls)
    - "Copy as curl" for the composed DSL (debug aid)
  - **Saved searches sidebar**:
    - Folder tree
    - Click to load params into the search form
    - Save current search: name + optional folder
    - Delete / rename
  - **Credential prompt**:
    - When user has no creds for selected endpoint: inline modal asking for OS username + password
    - "Test connection" button before saving
    - Saved indicator (green check) when creds exist
    - "Clear credentials" option

### API routes

- `app/api/opensearch/proxy/route.ts` — POST ?action=search|trace|deeplink|test-creds|list-endpoints
  - On missing creds: `422 { ok:false, message:'no_user_creds', data:{endpoint_id} }` (exact v1 shape for frontend compat)
- `app/api/opensearch/user-creds/route.ts` — GET (list status) / POST (save) / DELETE (remove)
- `app/api/opensearch/config/route.ts` — GET (admin: list endpoints) / POST (admin: add/update)
- `app/api/opensearch/saved-searches/route.ts` — GET/POST/PUT/DELETE
- `app/api/opensearch/saved-folders/route.ts` — GET/POST/PUT/DELETE

### Rules

- SM team only: `denyRoles: ["super_viewer"]`, `teams: ["sm"]` (per nav.ts)
- Team-scoped: all `opensearch_*.json` files via readTeamFile
- Creds encryption MUST round-trip with v1 PHP blobs — same `JWT_SECRET`, same envelope
- Session cookie key MUST be `endpoint_id:user_id` for v1 interop
- Never expose raw passwords in API responses — always mask or omit
- DSL builder: typed params only → server-side composition (never accept raw DSL from client)
- Zod on every write
- MSW mock for OpenSearch in tests
- logSecurity on credential save/delete

### Crypto implementation notes (from research/opensearch-creds.md)

```
Key derivation:  sha256(JWT_SECRET) → raw 32 bytes (no salt, no PBKDF2)
Cipher:          AES-256-CBC, PKCS#7 padding
Envelope:        base64(IV[16 bytes] || ciphertext)
Decrypt guard:   reject if raw length < 17 bytes
```

Use `node:crypto` createCipheriv/createDecipheriv with 'aes-256-cbc'. Test with a hardcoded vector to confirm PHP interop.

### Design

- Log explorer: split layout — search form on left/top, results table filling remaining space
- Histogram: stacked bar chart by log level, click to narrow time range
- Log entries: monospace font for REST/message, expandable accordion for full JSON
- Severity colors: TRACE=gray, DEBUG=blue, INFO=green, WARN=yellow, ERROR=orange, FATAL=red
- Credential prompt: clean modal with lock icon, test button shows green check/red x
- Saved searches: sidebar drawer with folder tree, drag-to-reorder
- Dark mode optimized (log viewer should look good on dark)
- Mobile: stack search above results, collapse saved searches into sheet

### Tests

- Unit: **AES-256-CBC roundtrip** — encrypt then decrypt returns original
- Unit: **v1 interop vector** — hardcoded JWT_SECRET + known IV + known plaintext → assert base64 matches PHP output
- Unit: **short/garbage input** — decrypt('aGk=') returns null
- Unit: DSL builder — given typed params, assert body matches v1 shape
- Unit: saved searches CRUD
- Integration: MSW mock OpenSearch responses, verify search + trace flow

## Verify

Dev JWT recipe in `HANDOFF.md`. Then: open log explorer → save creds → search → trace → save a search → reload. 3-4 screenshots to `/tmp/log-*.png`.

## Report (under 200 words)

What built, v1 endpoints matched, screenshots captured, gaps. No `npm install`.
