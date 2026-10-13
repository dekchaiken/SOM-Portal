// som-portal-v2/src/jira/fields.test.ts
// Parity tests against v1 api/jira/create.php. The config fixture is a copy of
// the real data/sm/jira_config.json catalog.
import { describe, it, expect } from "vitest";
import { JiraConfigSchema, type JiraConfig } from "./schemas";
import {
  buildIssueFields,
  faultStartFieldId,
  fieldTypeMap,
  formatJiraErrors,
  lintTemplateFields,
  nowFaultStart,
  splitMulti,
  toAdf,
  toJiraWire,
  visibleFields,
} from "./fields";

const CFG: JiraConfig = JiraConfigSchema.parse({
  categories: [
    { id: "c_001", name: "Incident" },
    { id: "c_004", name: "Case SMC" },
  ],
  issue_types: [{ id: "it_001", name: "Task" }],
  custom_fields: [
    { id: "cf_001", field_id: "customfield_17066", label: "Business Unit Impacted", placeholder: "e.g. TrueMoney TH", field_type: "array", enabled: true, order: 1 },
    { id: "cf_002", field_id: "customfield_17024", label: "TH Service Impacted", placeholder: "", field_type: "array", enabled: true, order: 2 },
    { id: "cf_003", field_id: "customfield_17023", label: "TH Channel / Component", placeholder: "", field_type: "array", enabled: true, order: 3 },
    { id: "cf_004", field_id: "customfield_17016", label: "Detected by", placeholder: "", field_type: "select", enabled: true, order: 4 },
    { id: "cf_005", field_id: "customfield_17238", label: "Caused by 3rd Party", placeholder: "", field_type: "select", enabled: true, order: 5 },
    { id: "cf_006", field_id: "customfield_17026", label: "Fault Start Date & Time", placeholder: "", field_type: "fault_start", enabled: true, order: 6 },
  ],
});

describe("jira/fields — catalog helpers", () => {
  it("maps field_id → field_type from jira_config.json", () => {
    expect(fieldTypeMap(CFG)).toEqual({
      customfield_17066: "array",
      customfield_17024: "array",
      customfield_17023: "array",
      customfield_17016: "select",
      customfield_17238: "select",
      customfield_17026: "fault_start",
    });
  });

  it("finds the configured fault_start field", () => {
    expect(faultStartFieldId(CFG)).toBe("customfield_17026");
  });

  it("falls back to the legacy fault_start id when none is configured", () => {
    expect(faultStartFieldId({ ...CFG, custom_fields: [] })).toBe("customfield_17026");
  });

  it("visibleFields drops disabled rows and sorts by order", () => {
    const cfg = {
      ...CFG,
      custom_fields: [
        { ...CFG.custom_fields[2]!, order: 9 },
        { ...CFG.custom_fields[0]!, order: 1 },
        { ...CFG.custom_fields[1]!, enabled: false },
      ],
    };
    expect(visibleFields(cfg).map((f) => f.field_id)).toEqual([
      "customfield_17066",
      "customfield_17023",
    ]);
  });
});

describe("jira/fields — wire serialization", () => {
  it("select → {value}", () => {
    expect(toJiraWire("select", "Service Monitoring (SM)")).toEqual({
      value: "Service Monitoring (SM)",
    });
  });

  it("array → [{value}] with v1 comma-split + trim", () => {
    expect(toJiraWire("array", "Fund-in, WeCard TH ,")).toEqual([
      { value: "Fund-in" },
      { value: "WeCard TH" },
    ]);
  });

  it("text → raw string", () => {
    expect(toJiraWire("text", "hello")).toBe("hello");
  });

  it("splitMulti drops empties", () => {
    expect(splitMulti(" a ,, b ")).toEqual(["a", "b"]);
  });

  it("nowFaultStart emits ISO-8601 with +0700 (PHP date('Y-m-d\\TH:i:s.000O'))", () => {
    const out = nowFaultStart(new Date("2026-10-12T03:04:05Z"));
    expect(out).toBe("2026-10-12T10:04:05.000+0700");
  });

  it("toAdf makes one paragraph per line, empty line → empty content", () => {
    expect(toAdf("a\n\nb")).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [] },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });
  });
});

describe("jira/fields — buildIssueFields (create.php parity)", () => {
  const base = {
    cfg: CFG,
    summary: "Service Fundin inApp GSB is unavialable",
    now: new Date("2026-10-12T03:04:05Z"),
  };

  it("builds the v1 payload from a real template fields map", () => {
    const out = buildIssueFields({
      ...base,
      fields: {
        issuetype: "Monitoring",
        customfield_17066: "TrueMoney",
        customfield_17024: "Fund-in",
        customfield_17023: "TrueMoney App",
        customfield_17016: "Service Monitoring (SM)",
        customfield_17238: "GSB",
        customfield_17026: "auto",
      },
    });
    expect(out).toEqual({
      project: { key: "SMC" },
      issuetype: { name: "Monitoring" },
      summary: "Service Fundin inApp GSB is unavialable",
      customfield_17066: [{ value: "TrueMoney" }],
      customfield_17024: [{ value: "Fund-in" }],
      customfield_17023: [{ value: "TrueMoney App" }],
      customfield_17016: { value: "Service Monitoring (SM)" },
      customfield_17238: { value: "GSB" },
      customfield_17026: "2026-10-12T10:04:05.000+0700",
    });
  });

  it("defaults issuetype to Task and omits empty fields", () => {
    const out = buildIssueFields({ ...base, fields: { customfield_17016: "" } });
    expect(out.issuetype).toEqual({ name: "Task" });
    expect(out).not.toHaveProperty("customfield_17016");
    expect(out).not.toHaveProperty("customfield_17026");
  });

  it("'manual' fault_start resolves to now, an explicit timestamp passes through", () => {
    expect(
      buildIssueFields({ ...base, fields: { customfield_17026: "manual" } }).customfield_17026,
    ).toBe("2026-10-12T10:04:05.000+0700");
    expect(
      buildIssueFields({
        ...base,
        fields: { customfield_17026: "2026-05-01T01:02:03.000+0700" },
      }).customfield_17026,
    ).toBe("2026-05-01T01:02:03.000+0700");
  });

  it("adds a description only when non-empty", () => {
    expect(buildIssueFields({ ...base, fields: {}, description: "  " })).not.toHaveProperty(
      "description",
    );
    expect(buildIssueFields({ ...base, fields: {}, description: "x" })).toHaveProperty(
      "description",
    );
  });

  it("applies the Incident Launcher fallbacks for fields absent from the catalog", () => {
    const out = buildIssueFields({
      ...base,
      cfg: { ...CFG, custom_fields: [] },
      fields: {
        customfield_17031: "S1",
        customfield_17066: "TrueMoney TH, TrueMoney MM",
      },
    });
    expect(out.customfield_17031).toEqual({ value: "S1" });
    expect(out.customfield_17066).toEqual([
      { value: "TrueMoney TH" },
      { value: "TrueMoney MM" },
    ]);
  });

  it("does not let the IL fallback override a catalog mapping", () => {
    const out = buildIssueFields({
      ...base,
      fields: { customfield_17016: "SM", customfield_17066: "A,B" },
    });
    expect(out.customfield_17016).toEqual({ value: "SM" });
    expect(out.customfield_17066).toEqual([{ value: "A" }, { value: "B" }]);
  });

  it("wraps batch selects and passes the cascading field through untouched", () => {
    const out = buildIssueFields({
      ...base,
      fields: {
        customfield_17019: "P2",
        customfield_17030: "Yes",
        customfield_17058: { value: "Daily", child: { value: "CSV" } },
      },
    });
    expect(out.customfield_17019).toEqual({ value: "P2" });
    expect(out.customfield_17030).toEqual({ value: "Yes" });
    expect(out.customfield_17058).toEqual({ value: "Daily", child: { value: "CSV" } });
  });
});

describe("jira/fields — drift tooling", () => {
  it("lints the orphan customfield_17022 found in tpl_001 (R-01 §2)", () => {
    const warnings = lintTemplateFields(CFG, {
      issuetype: "Task",
      customfield_17022: "TrueMoney TH",
      customfield_17024: "WeCard TH",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("customfield_17022");
  });

  it("formats Jira's error envelope like create.php", () => {
    expect(
      formatJiraErrors({ errors: { summary: "required" }, errorMessages: ["boom"] }, 400),
    ).toBe("summary: required | boom");
    expect(formatJiraErrors(null, 503)).toBe("HTTP 503");
  });
});
