// som-portal-v2/src/jira/templates.test.ts
// Runs against a temp copy of the REAL data/sm/templates.json +
// data/sm/jira_config.json so the stored shape is the v1 shape.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Session } from "@/auth/session";

let currentSession: Session | null = null;

vi.mock("@/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/auth/session")>("@/auth/session");
  return { ...actual, getSession: async (): Promise<Session | null> => currentSession };
});
vi.mock("@/logging/security", () => ({ logSecurity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/logging/activity", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { JsonAdapter, __setDataAdapter } from "@/data/json-adapter";
import {
  cleanFields,
  createTemplate,
  deleteTemplate,
  genId,
  getTemplate,
  listTemplates,
  loadJiraConfig,
  updateTemplate,
} from "./templates";

const V1_DATA = path.resolve(__dirname, "../../../data/sm");

let tmp: string;

const SM_LEAD: Session = { sub: "usr_t", username: "tester", role: "sm_lead", team: "sm" };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jira-tpl-"));
  await fs.mkdir(path.join(tmp, "sm"), { recursive: true });
  // Copy the real v1 files — this is the shape we must stay compatible with.
  for (const f of ["templates.json", "jira_config.json"]) {
    await fs.copyFile(path.join(V1_DATA, f), path.join(tmp, "sm", f));
  }
  __setDataAdapter(new JsonAdapter(tmp));
  currentSession = SM_LEAD;
});

afterEach(async () => {
  __setDataAdapter(null);
  currentSession = null;
  // Clean up every byte of test data.
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("jira/templates — real v1 files", () => {
  it("genId matches PHP genId('tpl')", () => {
    expect(genId("tpl")).toMatch(/^tpl_[0-9a-f]{12}$/);
  });

  it("parses the real jira_config.json catalog", async () => {
    const cfg = await loadJiraConfig();
    expect(cfg.categories.map((c) => c.name)).toContain("Incident");
    expect(cfg.custom_fields.find((f) => f.field_id === "customfield_17026")?.field_type).toBe(
      "fault_start",
    );
  });

  it("lists the real templates newest-first by created_at", async () => {
    const rows = await listTemplates();
    expect(rows.length).toBeGreaterThan(0);
    const dates = rows.map((r) => r.created_at);
    expect([...dates].sort().reverse()).toEqual(dates);
    // Known v1 row survives the round trip, orphan field included.
    const tpl001 = rows.find((r) => r.id === "tpl_001");
    expect(tpl001?.fields["customfield_17022"]).toBe("TrueMoney TH");
  });

  it("cleanFields keeps issuetype + customfield_* and defaults fault_start to 'auto'", async () => {
    const cfg = await loadJiraConfig();
    expect(
      cleanFields({ issuetype: " Task ", customfield_17016: "SM", junk: "x" }, cfg),
    ).toEqual({
      issuetype: "Task",
      customfield_17016: "SM",
      customfield_17026: "auto",
    });
  });

  it("create → read back from data/sm/templates.json on disk", async () => {
    const tpl = await createTemplate(
      { name: "  Vitest tpl  ", summary: " S ", category: " Incident ", fields: { issuetype: "Task" } },
      SM_LEAD,
    );
    expect(tpl.id).toMatch(/^tpl_/);
    expect(tpl.name).toBe("Vitest tpl");
    expect(tpl.summary).toBe("S");
    expect(tpl.created_by).toBe("usr_t");
    expect(tpl.author_name).toBe("tester");
    expect(tpl.fields["customfield_17026"]).toBe("auto");

    const raw = JSON.parse(
      await fs.readFile(path.join(tmp, "sm", "templates.json"), "utf8"),
    ) as { id: string }[];
    expect(raw.some((r) => r.id === tpl.id)).toBe(true);
    expect(await getTemplate(tpl.id)).not.toBeNull();
  });

  it("rejects a blank name / summary like v1", async () => {
    await expect(createTemplate({ name: " ", summary: "x" }, SM_LEAD)).rejects.toThrow(
      /name is required/i,
    );
    await expect(createTemplate({ name: "x", summary: " " }, SM_LEAD)).rejects.toThrow(
      /Summary/i,
    );
  });

  it("update patches only supplied keys", async () => {
    const tpl = await createTemplate({ name: "A", summary: "B" }, SM_LEAD);
    const after = await updateTemplate(tpl.id, { summary: " C " }, SM_LEAD);
    expect(after.name).toBe("A");
    expect(after.summary).toBe("C");
    expect(after.updated_at).toBeTruthy();
  });

  it("update / delete 404 on an unknown id", async () => {
    await expect(updateTemplate("tpl_nope", { name: "x" }, SM_LEAD)).rejects.toThrow(
      /not found/i,
    );
    await expect(deleteTemplate("tpl_nope", SM_LEAD)).rejects.toThrow(/not found/i);
  });

  it("delete removes the row and leaves the rest intact", async () => {
    const before = (await listTemplates()).length;
    const tpl = await createTemplate({ name: "Z", summary: "Z" }, SM_LEAD);
    await deleteTemplate(tpl.id, SM_LEAD);
    expect((await listTemplates()).length).toBe(before);
  });

  it("a non-SM role cannot write the SM-shared file", async () => {
    currentSession = { sub: "d", username: "d", role: "dev_user", team: "dev" };
    await expect(createTemplate({ name: "x", summary: "y" }, currentSession)).rejects.toThrow(
      /sm_/,
    );
  });
});
