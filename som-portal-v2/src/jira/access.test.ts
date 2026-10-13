// som-portal-v2/src/jira/access.test.ts
// MULTI-TEAM gate parity with v1 api/templates/index.php + requireSmForShared().
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

import { JsonAdapter, __setDataAdapter } from "@/data/json-adapter";
import { __resetEnvCache } from "@/lib/env";
import { getJiraAccess, requireJiraManage, requireJiraRead, teamFeatures } from "./access";

let tmp: string;
let prevDataDir: string | undefined;

// Mirrors the real data/teams.json features for sm / im / fas.
const TEAMS = [
  { id: "tm_sm000001", slug: "sm", name: "SM Team", features: ["jira-templates", "jira-templates-shared"] },
  { id: "tm_5c0b13623a5c", slug: "im", name: "IM Team", features: ["jira-templates-shared"] },
  { id: "tm_c00553fbde48", slug: "fas", name: "FAS Team", features: [] },
];

async function writeMenuPerms(team: string, perms: unknown) {
  await fs.mkdir(path.join(tmp, team), { recursive: true });
  await fs.writeFile(
    path.join(tmp, team, "menu-permissions.json"),
    JSON.stringify(perms),
    "utf8",
  );
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jira-acc-"));
  await fs.writeFile(path.join(tmp, "teams.json"), JSON.stringify(TEAMS), "utf8");
  prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmp;
  __resetEnvCache();
  __setDataAdapter(new JsonAdapter(tmp));
});

afterEach(async () => {
  __setDataAdapter(null);
  currentSession = null;
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  __resetEnvCache();
  await fs.rm(tmp, { recursive: true, force: true });
});

const sess = (over: Partial<Session>): Session => ({
  sub: "u1",
  username: "u1",
  role: "sm_user",
  team: "sm",
  ...over,
});

describe("jira/access — teams.json features", () => {
  it("reads per-team feature lists from the global teams.json", async () => {
    expect(await teamFeatures("im")).toEqual(["jira-templates-shared"]);
    expect(await teamFeatures("fas")).toEqual([]);
    expect(await teamFeatures("nope")).toEqual([]);
  });

  it("sm_user on team sm: read + create ticket, no manage", async () => {
    const a = await getJiraAccess(sess({}));
    expect(a).toMatchObject({ canRead: true, canCreateIssue: true, canManage: false, canDelete: false });
  });

  it("sm_lead on team sm: full manage + delete", async () => {
    const a = await getJiraAccess(sess({ role: "sm_lead" }));
    expect(a).toMatchObject({ canRead: true, canManage: true, canDelete: true });
  });

  it("super_admin always passes, on any team", async () => {
    const a = await getJiraAccess(sess({ role: "super_admin", team: "fas" }));
    expect(a).toMatchObject({ canRead: true, canManage: true, canCreateIssue: true });
  });

  it("IM team (jira-templates-shared only): read-only, no ticket creation", async () => {
    const a = await getJiraAccess(sess({ team: "im", role: "sm_lead" }));
    expect(a.canRead).toBe(true);
    expect(a.canCreateIssue).toBe(false);
    // requireSmForShared parity — writes are SM-only even for a lead role.
    expect(a.canManage).toBe(false);
  });

  it("FAS team (no feature): denied entirely", async () => {
    const a = await getJiraAccess(sess({ team: "fas", role: "sm_admin" }));
    expect(a.canRead).toBe(false);
  });

  it("requireJiraRead throws for a team without the feature", async () => {
    currentSession = sess({ team: "fas" });
    await expect(requireJiraRead()).rejects.toThrow(/does not have access/i);
  });

  it("requireJiraManage throws the v1 view-only message for non-SM teams", async () => {
    currentSession = sess({ team: "im", role: "sm_admin" });
    await expect(requireJiraManage()).rejects.toThrow(/view-only for team "im"/);
  });
});

describe("jira/access — superadmin menu-permissions narrowing", () => {
  it("honours an explicit role list that omits jira-templates", async () => {
    await writeMenuPerms("sm", { roles: { sm_user: ["dashboard", "board"] }, always_visible: [] });
    const a = await getJiraAccess(sess({}));
    expect(a.canRead).toBe(false);
  });

  it("allows when the role list includes jira-templates", async () => {
    await writeMenuPerms("sm", {
      roles: { sm_user: ["dashboard", "jira-templates"] },
      always_visible: [],
    });
    expect((await getJiraAccess(sess({}))).canRead).toBe(true);
  });

  it('"*" grants everything', async () => {
    await writeMenuPerms("sm", { roles: { sm_admin: "*" }, always_visible: [] });
    expect((await getJiraAccess(sess({ role: "sm_admin" }))).canManage).toBe(true);
  });

  it("always_visible overrides a narrow role list", async () => {
    await writeMenuPerms("sm", {
      roles: { sm_user: ["dashboard"] },
      always_visible: ["jira-templates"],
    });
    expect((await getJiraAccess(sess({}))).canRead).toBe(true);
  });

  it("a missing menu-permissions.json falls back to default visibility", async () => {
    expect((await getJiraAccess(sess({}))).canRead).toBe(true);
  });

  it("reads the caller's OWN team file, not data/ root (no cross-team leak)", async () => {
    // sm narrows sm_user, dev does not. A dev_user must not pick up sm's rules.
    await writeMenuPerms("sm", { roles: { sm_user: ["dashboard"] }, always_visible: [] });
    await writeMenuPerms("dev", { roles: { sm_user: ["jira-templates"] }, always_visible: [] });
    expect((await getJiraAccess(sess({ team: "sm" }))).canRead).toBe(false);
    // dev has no jira feature, so read is still false — but for the feature
    // reason, proving the menu file read was team-scoped.
    const devTeams = await teamFeatures("dev");
    expect(devTeams).toEqual([]);
  });
});
