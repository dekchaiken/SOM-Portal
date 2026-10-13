// som-portal-v2/src/jenkins/cooldown.ts
//
// Host cooldown — generic upstream circuit breaker. Direct port of
// `hostCooldownActive()` / `hostCooldownMark()` / `hostCooldownClear()` from
// api/helpers.php (shipped 2026-08-11 after the DRP-DNS incident, where every
// page request serially waited out a 4s connect timeout against a Jenkins host
// whose DNS record had moved).
//
// Semantics, kept identical to v1 so PHP and v2 share one breaker file:
//   • File:  DATA_DIR/host-cooldown.json  (global — NOT team-scoped, because a
//            dead upstream is dead for every team).
//   • Shape: { "<lowercase host>": { "fail_at": <unix secs>, "reason": "..." } }
//   • Trip:  ANY transport error, code 0, or HTTP >= 500 marks the host. v1 has
//            no failure counter — one hard failure opens the breaker.
//   • Open:  for HOST_COOLDOWN_TTL (30s) after `fail_at`. While open, callers
//            short-circuit with code 0 and an `err` naming the reason instead
//            of dialling the host at all.
//   • Close: the entry simply expires — the next request after TTL probes the
//            host for real, so TTL doubles as the half-open window.
//   • GC:    entries older than TTL*4 are dropped on every write.
//
// The brief asked for "open after N fail, half-open after 60s"; v1's actual
// contract is N=1 / 30s and the user's instruction is to match v1, so the v1
// numbers win. Both knobs are exported if that ever needs revisiting.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { dataDirAbsolute } from '@/lib/env';

export const HOST_COOLDOWN_FILE = 'host-cooldown.json';
/** Seconds a failing host is skipped. v1: `const HOST_COOLDOWN_TTL = 30`. */
export const HOST_COOLDOWN_TTL = 30;
/** Consecutive failures needed to open the breaker. v1 trips on the first. */
export const HOST_COOLDOWN_FAIL_THRESHOLD = 1;

const EntrySchema = z
  .object({ fail_at: z.coerce.number().default(0), reason: z.string().default('') })
  .passthrough();
const FileSchema = z.record(z.string(), EntrySchema).default({});
type CooldownFile = z.infer<typeof FileSchema>;

export interface CooldownState {
  reason: string;
  fail_at: number;
  expires_at: number;
}

function cooldownPath(): string {
  return path.join(dataDirAbsolute(), HOST_COOLDOWN_FILE);
}

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Lowercase hostname from a URL, or '' when unparsable. Port of `hostFromUrl`. */
export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Per-request memo, mirroring v1's $GLOBALS['_host_cooldown_cache'].
let memo: { data: CooldownFile; at: number } | null = null;

async function readCooldownFile(): Promise<CooldownFile> {
  // 1s memo: a single page render can fan out to a dozen Jenkins calls and
  // should not re-read the file for each, but must not cache across requests.
  if (memo && Date.now() - memo.at < 1000) return memo.data;
  let parsed: CooldownFile = {};
  try {
    const raw = await fs.readFile(cooldownPath(), 'utf8');
    const j = FileSchema.safeParse(JSON.parse(raw));
    if (j.success) parsed = j.data;
  } catch {
    /* missing or corrupt → treat as no cooldowns, same as v1 */
  }
  memo = { data: parsed, at: Date.now() };
  return parsed;
}

/**
 * Is the breaker open for `host`? Returns the reason + expiry while open,
 * `null` once the entry has aged past TTL.
 */
export async function hostCooldownActive(host: string): Promise<CooldownState | null> {
  if (host === '') return null;
  const entry = (await readCooldownFile())[host];
  if (!entry) return null;
  const expires_at = entry.fail_at + HOST_COOLDOWN_TTL;
  if (nowSecs() >= expires_at) return null;
  return { reason: entry.reason || 'previous failure', fail_at: entry.fail_at, expires_at };
}

/** Trip the breaker for `host`. Reason is truncated to 200 chars, as in v1. */
export async function hostCooldownMark(host: string, reason: string): Promise<void> {
  if (host === '') return;
  const file = cooldownPath();
  const now = nowSecs();
  let data: CooldownFile = {};
  try {
    const j = FileSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
    if (j.success) data = j.data;
  } catch {
    /* start fresh */
  }
  // GC long-expired entries so the file stays small (v1 uses TTL * 4).
  for (const [h, e] of Object.entries(data)) {
    if (e.fail_at + HOST_COOLDOWN_TTL * 4 < now) delete data[h];
  }
  data[host] = { fail_at: now, reason: [...reason].slice(0, 200).join('') };
  await writeAtomic(file, data);
  memo = { data, at: Date.now() };
}

/**
 * Drop `host`'s entry. Called right after ops edits a server's base_url or
 * ip_override so the fresh config probes immediately instead of waiting out
 * the previous failure (v1 does this in jenkins-servers POST/PUT).
 */
export async function hostCooldownClear(host: string): Promise<void> {
  if (host === '') return;
  const file = cooldownPath();
  let data: CooldownFile = {};
  try {
    const j = FileSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
    if (j.success) data = j.data;
  } catch {
    return; // nothing to clear
  }
  if (!(host in data)) {
    memo = { data, at: Date.now() };
    return;
  }
  delete data[host];
  await writeAtomic(file, data);
  memo = { data, at: Date.now() };
}

/** Full breaker state, for the admin page's "upstream health" strip. */
export async function listCooldowns(): Promise<Array<CooldownState & { host: string }>> {
  const data = await readCooldownFile();
  const now = nowSecs();
  return Object.entries(data)
    .map(([host, e]) => ({
      host,
      reason: e.reason || 'previous failure',
      fail_at: e.fail_at,
      expires_at: e.fail_at + HOST_COOLDOWN_TTL,
    }))
    .filter((c) => now < c.expires_at);
}

/** True when the HTTP outcome should trip the breaker. v1: err || 0 || >= 500. */
export function shouldTrip(code: number, err: string): boolean {
  return err !== '' || code === 0 || code >= 500;
}

async function writeAtomic(file: string, data: CooldownFile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  // v1 writes JSON_PRETTY_PRINT; keep it so diffs stay readable for ops.
  await fs.writeFile(tmp, JSON.stringify(data, null, 4), 'utf8');
  await fs.rename(tmp, file);
}

/** Test-only: drop the in-process memo. */
export function __resetCooldownMemo(): void {
  memo = null;
}
