// som-portal-v2/src/auth/user-lookup.ts
// Server-only. Walks the data/<team>/users.json files to find a user by
// username. v1 stored users per-team; v2 keeps that layout for dual-run.

import fs from "node:fs/promises";
import path from "node:path";
import { dataDirAbsolute } from "@/lib/env";

export interface UserRecord {
  id: string;
  username: string;
  name?: string;
  nickname?: string;
  email?: string;
  role: string;
  password?: string;
  avatar_url?: string;
  must_reset_password?: boolean;
  password_expired?: boolean;
  first_login?: boolean;
  is_genz?: boolean;
  dev_subteam?: string;
  password_changed_at?: string;
  created_at?: string;
}

export interface UserHit {
  user: UserRecord;
  team: string;
}

async function listTeamDirs(dataDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dataDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

async function readUsersFile(file: string): Promise<UserRecord[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray(data.users)) return data.users;
    return [];
  } catch {
    return [];
  }
}

/**
 * Find a user by username across every team's users.json.
 * Returns the matching user + its team slug, or null.
 */
export async function findUserByUsername(username: string): Promise<UserHit | null> {
  const needle = username.trim().toLowerCase();
  if (!needle) return null;

  const dataDir = dataDirAbsolute();
  const teams = await listTeamDirs(dataDir);

  // Priority: SM first (biggest team), then every other team.
  teams.sort((a, b) => (a === "sm" ? -1 : b === "sm" ? 1 : a.localeCompare(b)));

  for (const team of teams) {
    const file = path.join(dataDir, team, "users.json");
    const users = await readUsersFile(file);
    const hit = users.find((u) => u.username?.toLowerCase() === needle);
    if (hit) return { user: hit, team };
  }

  // Fallback: data/users.json (global, legacy / super_admin area).
  const globalFile = path.join(dataDir, "users.json");
  const globalUsers = await readUsersFile(globalFile);
  const hit = globalUsers.find((u) => u.username?.toLowerCase() === needle);
  if (hit) return { user: hit, team: hit.role === "super_admin" ? "sm" : "sm" };

  return null;
}
