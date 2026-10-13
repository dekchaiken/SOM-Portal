# R-01 — Jira Custom-Field Mapping Audit

Site: `truemoney.atlassian.net` · Project key: `SMC` · API: Jira Cloud REST v3.

## 1. How v1 wires fields today

- Field catalog lives in **`data/jira_config.json`** (global) and **`data/sm/jira_config.json`** (per-team; currently byte-identical to global). Shape = `{ categories[], issue_types[], custom_fields[] }`.
- Each `custom_fields[]` entry carries `field_id` (`customfield_NNNNN`), human `label`, `field_type` ∈ `{text, select, array, fault_start}` (NOT a Jira schema type — a serialization hint used by `api/jira/create.php`).
- **Templates** (`data/[sm/]templates.json`) store defaults keyed by the raw Jira `customfield_*` ID (plus `issuetype` by name). Values are plain strings — multi-selects use comma-separated strings that `create.php` splits.
- **`api/jira/create.php`** reads the type map, then builds the REST v3 payload:
  - `select` → `{ value: str }`
  - `array` → `[{ value: str }, …]` (comma-split)
  - `fault_start` → ISO 8601 w/ offset (auto = `now()`)
  - text/other → raw string
  - Hardcoded fallbacks for Incident Launcher (`17031/17016/17238` as select, `17066/17024/17023` as array) and batch (`17019/17030` select, `17058` cascading — passed through as-is).
- **`api/jira/fields.php`** → `/rest/api/3/field` list, filters `customfield_*`, returns `{id,name,type}`.
- **`api/jira/field-options.php`** → `createmeta?expand=…fields` first, falls back to `/field/{id}/context` + `/context/{ctxId}/option`.
- **`api/jira/batch-fields.php`** → same two-step pattern specialized for `17019/17030/17058` (cascading parent/children).
- **`api/jira/issue-types.php`** → `createmeta` → `projects[0].issuetypes[]`.
- **`api/jira/incidents.php`** reads `customfield_17031.value` (Severity) and `customfield_17016.value` (Detected by) off issue search results.

## 2. Observed fields

| field_id | Label | v1 `field_type` | Jira wire shape | Used in |
|---|---|---|---|---|
| customfield_17016 | Detected by | select | `{value}` | config, create, incidents, IL |
| customfield_17019 | SM Priority | select (hardcoded) | `{value}` | batch |
| customfield_17022 | (orphan — in 1 template, not in config) | — | string | legacy template |
| customfield_17023 | TH Channel / Component | array | `[{value}]` | config, create, IL |
| customfield_17024 | TH Service Impacted | array | `[{value}]` | config, create, IL |
| customfield_17026 | Fault Start Date & Time | fault_start | ISO datetime | config, create |
| customfield_17030 | Batch Issue | select (hardcoded) | `{value}` | batch |
| customfield_17031 | Severity | select (hardcoded in create.php IL fallback) | `{value}` | incidents (read), IL (write) |
| customfield_17058 | Batch File Type | cascading | `{value, child:{value}}` | batch |
| customfield_17066 | Business Unit Impacted | array | `[{value}]` | config, create, IL |
| customfield_17238 | Caused by 3rd Party | select | `{value}` | config, create, IL |

11 live IDs. 1 orphan (`17022`) still present in a legacy template row — v2 should treat as string-passthrough and surface a lint warning.

## 3. Drift risks

1. **Field IDs are per-site**; staging/prod divergence or Jira field re-creation renumbers them. v1 has no detection.
2. **`field_type` is a v1 invention**, not Jira's schema. Mapping `fault_start` is purely implicit (type == `customfield_17026`).
3. **Hardcoded fallbacks in `create.php` and `batch-fields.php`** duplicate the catalog; if an admin disables an IL field in `jira_config.json`, the hardcoded path still sends it.
4. **Multi-select = comma-split string** loses commas inside option values. (Low risk today — all observed TMN values are comma-free, but not enforced.)
5. **Templates aren't validated against the catalog** — `17022` is proof. Also: no check that a template's `issuetype` exists in `issue_types[]`.
6. **Cascading selects** (`17058`) go through a different code path (array passed as-is). Rename to a cascade elsewhere and it silently falls through to the generic branch.
7. **Per-team config is unused** — `data/sm/jira_config.json` is a verbatim copy. Either formally per-team (so FAS/CMT can diverge) or move to a single file.
8. **Jira response read shape** uses `.value` directly (`incidents.php`) — null if Jira ever returns the field as object/array differently (e.g. multi-select would be `[0].value`).

## 4. Proposed v2 shape

### Storage (unchanged runtime file, enriched schema)

```jsonc
{
  "issueTypes": [{ "id": "10001", "name": "Task" }],
  "categories": [{ "id": "c_001", "name": "Incident" }],
  "customFields": [
    {
      "fieldId": "customfield_17016",
      "label": "Detected by",
      "kind": "select",             // select | multiSelect | cascade | text | datetime | number
      "role": "detectedBy",         // optional semantic alias, see roles below
      "required": false,
      "enabled": true,
      "order": 4,
      "defaultValue": null,
      "placeholder": "e.g. Service Monitoring (SM)"
    }
  ]
}
```

### Semantic roles

A small enum (`detectedBy | severity | causedByThirdParty | serviceImpacted | businessUnit | channel | faultStart | smPriority | batchIssue | batchFileType`). The v2 client exposes typed accessors (`client.setDetectedBy(…)`) that resolve to whichever `customfield_*` currently owns the role. Hardcoded IDs vanish from code.

### Zod schemas (see `jira-fields.proposed.ts`)

- `JiraCustomFieldDefSchema` — one catalog row.
- `JiraFieldCatalogSchema` — the file as a whole, parsed in `.safeParse()` mode so unknown keys / drift are logged, not thrown.
- `JiraIssueFieldsSchema` — Jira wire response. Uses `z.record(z.unknown())` for `customfield_*` and typed accessors read keys via `role → fieldId` lookup.
- `TemplateFieldsSchema` — accepts anything but warns when a key is not in the catalog (soft-fail).

### Build-time vs runtime split

- The **role → fieldId map** is loaded at request time (Server Component / route handler) from the live JSON, since per-site IDs can't be baked.
- The **shape of the catalog** is Zod-validated at build via a `scripts/validate-jira-config.ts` run on `pnpm build`, and again at request time (`safeParse` → logs + fallback to empty catalog, mirroring v1's tolerance for missing files).

## 5. Phase 1 recommendations

1. **Introduce `role`** on each catalog row and ship a one-time migration that fills it from today's IDs. No code reads `customfield_17016` directly after Phase 1.
2. **Replace `field_type` with `kind`** (closer to Jira's actual schema terms). Keep a legacy reader that maps old values on load.
3. **Centralize serialization** in a `toJiraWire(kind, value)` function; delete the IL/batch hardcoded blocks in `create.php` port.
4. **Add catalog validation on write** in the admin endpoint (`jira-config` module) — unknown kinds / duplicate roles → 400.
5. **Lint templates on load**: any key not in catalog → `warnings[]` in the GET response; UI surfaces an admin banner. (Picks up `17022` immediately.)
6. **Keep per-team catalogs** but add a `inheritFromGlobal: true` flag so SM/CMT/FAS don't drift accidentally.
7. **Cascading field is a first-class kind** (`cascade`), stored as `{ value, child? }` end-to-end — no array-passthrough.
8. **Soft-fail everywhere**: wrap `createmeta` + `/field/{id}/context` reads in `safeParse`; on drift, return the last-known catalog from disk and set a `stale: true` flag.
