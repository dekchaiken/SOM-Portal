# R-03 — OpenSearch Per-User Credentials Migration

Research notes for porting v1's AES-256-CBC per-user OpenSearch credential
system to the Next.js v2 rewrite. v2 must read the SAME ciphertext blobs
written by v1 (shared `.env` secret, zero re-entry for users).

Source files reviewed:
- `api/opensearch-user-creds/index.php` (crypto + CRUD)
- `api/opensearch-proxy/index.php` (consumer, DSL builder, session cache)
- `api/opensearch-config/index.php` (admin endpoint registry, redaction)
- `api/opensearch-saved-searches/index.php` (team-shared params shape)
- `api/opensearch-saved-folders/index.php`
- `log-explorer.html` (frontend consumer; prompts for creds inline)

---

## 1. v1 Crypto Details

**Cipher:** `AES-256-CBC` via `openssl_encrypt / openssl_decrypt` with
`OPENSSL_RAW_DATA` (no base64 inside OpenSSL — we base64 the whole envelope).

**Key derivation:** `hash('sha256', JWT_SECRET, true)` — the raw 32-byte
SHA-256 digest of the `JWT_SECRET` env var. There is NO salt, NO PBKDF2/scrypt,
NO per-record KDF. One static key per deployment.

**IV:** `random_bytes(16)` — fresh 16 random bytes per encryption. Prepended
to the ciphertext.

**Padding:** PKCS#7 (OpenSSL default for CBC when `OPENSSL_ZERO_PADDING` is
NOT set — which it isn't here).

**Envelope layout** (what gets base64-encoded and stored):

```
offset 0 .. 15   : IV           (16 bytes, random)
offset 16 .. end : ciphertext   (PKCS#7-padded, variable length)
```

Then `base64_encode(IV || ciphertext)` → the string stored in
`password_enc`. Decryption rejects anything shorter than 17 raw bytes
(= IV + at least one block boundary byte).

**MAC / authentication:** none. CBC is unauthenticated. v2 should keep
decrypt-compatibility but new writes could optionally upgrade to AES-256-GCM
(see §3 "Forward plan").

**Known weaknesses (document, do not fix in R-03):**
- Static key tied to `JWT_SECRET` → rotating JWT_SECRET invalidates every
  stored OpenSearch password (and every active login JWT). Operators need
  to be aware.
- Unauthenticated CBC → a tampered ciphertext decrypts to garbage silently;
  v1 just hands that garbage to OpenSearch as a password and gets a 401.
  Low risk because the file is behind `data/.htaccess` + SM-only auth.
- Same `JWT_SECRET` reused for signing JWTs AND deriving an encryption
  key. Not best practice but tolerable here.

## 2. Storage Location

- **File:** `data/sm/opensearch_user_creds.json` (team-scoped via
  `requireSmTeamOnly` → helpers resolve to `data/sm/…`).
- **Permissions:** written through `writeJson()` with `flock`. Also blocked
  from the browser by `data/.htaccess`.
- **Shape:**
  ```jsonc
  {
    "<user_id>": {
      "<endpoint_id>": {
        "username":     "<plaintext OS username>",
        "password_enc": "<base64(IV || ciphertext)>",
        "saved_at":     1739999999
      }
    }
  }
  ```
- **Companion files touched by the same subsystem:**
  - `data/sm/opensearch_config.json` — admin endpoint registry (base_url,
    auth_mode, default_index_pattern, admin creds for cluster-health probes).
  - `data/sm/opensearch_sessions.json` — Dashboards-mode session cookies,
    cache key is `endpoint_id:user_id`. v2 should write with the same key
    so a user who logs into v1 then opens v2 reuses the cookie until it
    expires (30 min TTL constant, Dashboards itself gives 1h).
  - `data/sm/opensearch_saved_searches.json` — team-shared saved filter
    sets (not credentials). Shape: `{id, name, params, folder_id?, created_by, created_by_name, created_at, history[]}`.
  - `data/sm/opensearch_saved_folders.json` — folder tree for the above.

## 3. v2 Adoption Plan

**Goal:** a v2 user who already saved creds in v1 should hit `/v2/log-explorer`
and search without re-entering anything. Writes from v2 should round-trip to v1.

**Approach:**

1. **Share `.env`.** The Next.js app reads `JWT_SECRET` (and the shared
   `DATA_DIR` path) from the same `.env` file. No new env var — if we invent
   `OPENSEARCH_CREDS_KEY`, v1 and v2 fork and the whole "no re-entry"
   promise breaks.

2. **Port the primitive 1:1.** Implement `encryptCreds` / `decryptCreds`
   using Node's `crypto.webcrypto` (preferred) or `node:crypto` subtle:
   - Derive key: `sha256(JWT_SECRET)` raw 32 bytes.
   - IV: 16 random bytes.
   - AES-256-CBC + PKCS#7 (web crypto `AES-CBC` is PKCS#7 by default).
   - Envelope: base64(IV ‖ ciphertext). Decrypt rejects len < 17.

3. **Reader module** (`lib/server/opensearch/creds.ts`) exposes:
   ```
   loadUserCreds(userId, endpointId): Promise<{username, password} | null>
   saveUserCreds(userId, endpointId, {username, password}): Promise<void>
   deleteUserCreds(userId, endpointId): Promise<void>
   listEndpointStatus(userId): Promise<Array<{endpoint_id, has_creds, username, saved_at}>>
   ```
   All backed by `readJson/writeJson` wrappers that must point at
   `data/sm/opensearch_user_creds.json` (team scoping should happen at
   the data-layer helper, matching v1).

4. **Proxy consumer** mirrors `_osUserCreds` in `api/opensearch-proxy/`:
   on `search` / `trace`, pull the user's decrypted creds; if `null`,
   respond `422` with `{ok:false, message:'no_user_creds', data:{endpoint_id}}`
   — the frontend already recognizes this literal and shows the credential
   prompt. v2 MUST keep that exact wire shape.

5. **Session cookie reuse:** when v2 performs Dashboards-mode queries, use
   `${endpointId}:${userId}` as the sessions.json cache key (same as v1).
   Cookies interop with v1.

6. **Optional (future ticket, NOT R-03):** add an `enc_v: 2` marker and
   migrate new writes to AES-256-GCM with `JWT_SECRET`-derived HKDF
   subkeys per endpoint. Keep decrypt backward-compat with v1 blobs
   (no `enc_v` = v1 CBC).

## 4. DSL Builder Audit

The v1 proxy accepts **typed params only** — never raw DSL — then composes
the body server-side. v2 must preserve this contract. Fields allowed:

| field            | type           | validation                                     |
|------------------|----------------|------------------------------------------------|
| `endpoint_id`    | string         | must exist + be enabled                        |
| `index_pattern`  | string         | `/^[a-z0-9_\-.*,]+$/i`, else 400               |
| `module`         | string?        | exact term on `Module.keyword` / `Module`      |
| `log_level`      | enum?          | TRACE/DEBUG/INFO/WARN/ERROR/FATAL              |
| `correlation_id` | string?        | exact term match                               |
| `q`              | string?        | ≤200 chars, `query_string` default_field=REST  |
| `regexp_rest`    | string?        | ≤500 chars, `regexp` on `REST`                 |
| `range`          | preset enum    | last_5m / 15m / 30m / 1h / 4h / 12h / 24h / 3d / 7d |
| `start`,`end`    | ISO?           | wins over `range`; `e > s` required            |
| `size`           | int            | clamp [1, max_size] (default 1000)             |
| `from`           | int            | clamp [0, 9000]                                |

Histogram interval is auto-chosen from span to target ~30 buckets.
`track_total_hits: 10000`, `timeout: '30s'`, sort desc on `@timestamp`.
Aggs: histogram (sub-agg `by_level`), `top_pods` terms.

The `trace` action drops Module/level filters, filters on CORRELATION_ID
only, extends `lte` by 90s (log-shipping skew), aggregates `by_module`.

**v2 implementation note:** encode the above as a Zod schema and build
the DSL in TypeScript. See `opensearch-creds.proposed.ts`.

## 5. Proposed v2 Module Shape

```
lib/server/opensearch/
  creds.ts         # encrypt/decrypt + CRUD (reads data/sm/opensearch_user_creds.json)
  endpoints.ts     # reads opensearch_config.json, lists + validates endpoint_id
  dsl.ts           # Zod schema + buildSearchDsl / buildTraceDsl
  client.ts        # OpenSearchClient — basic + dashboards modes, session cache
  sessions.ts      # Dashboards session cookie cache (data/sm/opensearch_sessions.json)
  normalize.ts     # normalizeHit, parseStatus, parseLatency (port of _osNormalizeHit)

app/api/opensearch/
  user-creds/route.ts    # GET/POST/DELETE  — mirrors api/opensearch-user-creds/
  proxy/route.ts         # POST ?action=search|trace|deeplink|test-creds|list-endpoints
```

- `creds.ts` MUST return `null` (not throw) when a user has no entry — the
  proxy relies on `null` to emit the `no_user_creds` 422 for the frontend prompt.
- All callers must go through `requireSmTeamOnly` equivalent in v2 middleware
  — these endpoints are SM-only in v1.
- Keep file I/O behind the same `readJson/writeJson` wrapper so file-locking
  (flock in v1, `proper-lockfile` or similar in v2) stays consistent and
  neither app corrupts the other's writes.

**Tests to port into Vitest** (sketch in companion file):
1. CBC round-trip: `encrypt(x)` then `decrypt(result)` returns `x`.
2. v1 interop vector: given a hard-coded `JWT_SECRET` + known IV + known
   plaintext, assert the base64 envelope matches what PHP produces.
3. Short/garbage input: `decrypt('aGk=')` returns `null` (len<17 guard).
4. DSL builder: given typed params, assert the composed body matches the
   v1 shape byte-for-byte on the fields that cross the wire.
