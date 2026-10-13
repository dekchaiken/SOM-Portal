// R-03 — Proposed v2 shape for OpenSearch per-user credentials.
// Decrypt-compatible with v1 (api/opensearch-user-creds/index.php).
//
// v1 envelope:  base64( IV[16] || AES-256-CBC(PKCS7, key=sha256(JWT_SECRET), plaintext) )
// Static key, random IV per record, no MAC — see opensearch-creds.md §1.
//
// This file is a SKETCH for review. It does not import real server deps
// (readJson/writeJson, auth middleware). Those are stubbed via comments.

import { webcrypto } from "node:crypto";
import { z } from "zod";

// ─── Crypto ────────────────────────────────────────────────────────────────

const subtle = webcrypto.subtle;

async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
  // v1: hash('sha256', JWT_SECRET, true) — raw 32-byte digest, no salt.
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(jwtSecret));
  return subtle.importKey("raw", digest, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
}

export async function encryptCreds(plaintext: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const iv = webcrypto.getRandomValues(new Uint8Array(16));
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-CBC", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const envelope = new Uint8Array(iv.length + ct.length);
  envelope.set(iv, 0);
  envelope.set(ct, iv.length);
  return Buffer.from(envelope).toString("base64");
}

export async function decryptCreds(b64: string, jwtSecret: string): Promise<string | null> {
  const raw = Buffer.from(b64, "base64");
  if (raw.length < 17) return null; // v1 guard — IV + at least one CT byte
  const iv = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  try {
    const key = await deriveKey(jwtSecret);
    const pt = await subtle.decrypt({ name: "AES-CBC", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null; // tampered / wrong key / bad padding
  }
}

// ─── Storage layer (stub) ──────────────────────────────────────────────────
// Real impl reads data/sm/opensearch_user_creds.json via the shared readJson
// helper. Shape mirrors v1 exactly so writes are round-trippable.

type UserCredsFile = Record<
  string, // userId
  Record<
    string, // endpointId
    { username: string; password_enc: string; saved_at: number }
  >
>;

// declare function readJson<T>(name: string): Promise<T>;
// declare function writeJson<T>(name: string, data: T): Promise<void>;
// const CREDS_FILE = "opensearch_user_creds.json";

export interface DecryptedCreds { username: string; password: string }

export async function loadUserCreds(
  userId: string,
  endpointId: string,
  jwtSecret: string,
  // reader: typeof readJson,
): Promise<DecryptedCreds | null> {
  // const all = (await reader<UserCredsFile>(CREDS_FILE)) ?? {};
  const all: UserCredsFile = {}; // stub
  const entry = all[userId]?.[endpointId];
  if (!entry?.username || !entry?.password_enc) return null;
  const pw = await decryptCreds(entry.password_enc, jwtSecret);
  if (pw === null) return null;
  return { username: entry.username, password: pw };
}

// ─── DSL schema (Zod) ──────────────────────────────────────────────────────
// Mirrors _osBuildQuery in api/opensearch-proxy/index.php. Server-side only;
// browser never ships raw DSL. See opensearch-creds.md §4.

export const LogLevel = z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);

export const TimeRange = z.enum([
  "last_5m", "last_15m", "last_30m", "last_1h",
  "last_4h", "last_12h", "last_24h", "last_3d", "last_7d",
]);

export const DslQuery = z
  .object({
    endpoint_id: z.string().min(1),
    index_pattern: z.string().regex(/^[a-z0-9_\-.*,]+$/i).optional(),
    module: z.string().trim().optional(),
    log_level: LogLevel.optional(),
    correlation_id: z.string().trim().optional(),
    q: z.string().max(200).optional(),
    regexp_rest: z.string().max(500).optional(),
    range: TimeRange.default("last_15m"),
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
    size: z.number().int().min(1).max(1000).default(200),
    from: z.number().int().min(0).max(9000).default(0),
  })
  .refine((v) => !v.start === !v.end, { message: "start and end must both be set" });

export type DslQueryInput = z.infer<typeof DslQuery>;

// ─── Client skeleton ───────────────────────────────────────────────────────
// Full impl handles basic + dashboards modes, session cookie cache keyed by
// `${endpointId}:${userId}` (v1-compatible), 401-retry, host cooldown, etc.

export interface Endpoint {
  id: string;
  base_url: string;
  auth_mode: "basic" | "dashboards";
  osd_version?: string;
  default_index_pattern: string;
  enabled?: boolean;
}

export class OpenSearchClient {
  constructor(
    private endpoint: Endpoint,
    private creds: DecryptedCreds,
    private userId: string,
  ) {}

  async search(input: DslQueryInput): Promise<unknown> {
    const parsed = DslQuery.parse(input);
    const dsl = buildSearchDsl(parsed);
    // basic: POST base_url + /<index>/_search  with HTTP basic auth
    // dashboards: POST /internal/search/opensearch with session cookie
    //   cache key: `${this.endpoint.id}:${this.userId}` for v1 interop
    void dsl;
    throw new Error("not implemented in sketch");
  }

  async trace(correlationId: string, input: DslQueryInput): Promise<unknown> {
    void correlationId;
    void input;
    throw new Error("not implemented in sketch");
  }
}

function parseTimeRange(input: Pick<DslQueryInput, "range" | "start" | "end">): [number, number, string] {
  const now = Date.now();
  let gte: number, lte: number;
  if (input.start && input.end) {
    gte = Date.parse(input.start);
    lte = Date.parse(input.end);
  } else {
    const mins: Record<z.infer<typeof TimeRange>, number> = {
      last_5m: 5, last_15m: 15, last_30m: 30, last_1h: 60,
      last_4h: 240, last_12h: 720, last_24h: 1440, last_3d: 4320, last_7d: 10080,
    };
    const m = mins[input.range];
    gte = now - m * 60_000;
    lte = now;
  }
  const spanSec = Math.max(60, (lte - gte) / 1000);
  const interval =
    spanSec <= 900 ? "30s" :
    spanSec <= 3600 ? "2m" :
    spanSec <= 14400 ? "10m" :
    spanSec <= 43200 ? "30m" :
    spanSec <= 86400 ? "1h" :
    spanSec <= 259200 ? "3h" : "12h";
  return [gte, lte, interval];
}

export function buildSearchDsl(input: DslQueryInput): Record<string, unknown> {
  const [gte, lte, interval] = parseTimeRange(input);
  const filter: unknown[] = [{ range: { "@timestamp": { gte, lte, format: "epoch_millis" } } }];
  const must: unknown[] = [];
  if (input.module) {
    filter.push({ bool: { should: [
      { term: { "Module.keyword": input.module } },
      { term: { Module: input.module } },
    ], minimum_should_match: 1 } });
  }
  if (input.log_level) {
    filter.push({ bool: { should: [
      { term: { "Log_Level.keyword": input.log_level } },
      { term: { Log_Level: input.log_level } },
    ], minimum_should_match: 1 } });
  }
  if (input.correlation_id) {
    filter.push({ bool: { should: [
      { term: { "CORRELATION_ID.keyword": input.correlation_id } },
      { term: { CORRELATION_ID: input.correlation_id } },
    ], minimum_should_match: 1 } });
  }
  if (input.q) {
    must.push({ query_string: { query: input.q, default_field: "REST", analyze_wildcard: true, lenient: true } });
  }
  if (input.regexp_rest) {
    must.push({ regexp: { REST: { value: input.regexp_rest, flags: "ALL", case_insensitive: true } } });
  }
  return {
    size: input.size, from: input.from,
    sort: [{ "@timestamp": { order: "desc" } }],
    query: { bool: { must, filter } },
    aggs: {
      histogram: {
        date_histogram: { field: "@timestamp", fixed_interval: interval, min_doc_count: 0, extended_bounds: { min: gte, max: lte } },
        aggs: { by_level: { terms: { field: "Log_Level.keyword", size: 6, missing: "UNKNOWN" } } },
      },
      top_pods: { terms: { field: "kubernetes.pod_name.keyword", size: 10, missing: "" } },
    },
    track_total_hits: 10000,
    timeout: "30s",
  };
}

// ─── Vitest tests ──────────────────────────────────────────────────────────
// NOTE: real file lives in tests/ — inlined here to keep R-03 self-contained.
/*
import { describe, it, expect } from "vitest";

describe("opensearch creds crypto", () => {
  const SECRET = "test-secret-do-not-use-in-prod";

  it("round-trips a password through encrypt/decrypt", async () => {
    const enc = await encryptCreds("p@ssw0rd-example", SECRET);
    expect(enc).toMatch(/^[A-Za-z0-9+/=]+$/);
    const dec = await decryptCreds(enc, SECRET);
    expect(dec).toBe("p@ssw0rd-example");
  });

  it("returns null for short / garbage input (v1 len<17 guard)", async () => {
    expect(await decryptCreds("aGk=", SECRET)).toBeNull();      // 2 bytes
    expect(await decryptCreds("!!!not-base64!!!", SECRET)).toBeNull();
  });

  it("returns null when the secret is wrong (bad padding → catch)", async () => {
    const enc = await encryptCreds("hello", SECRET);
    expect(await decryptCreds(enc, "different-secret")).toBeNull();
  });

  it("builds a search DSL that matches the v1 contract shape", () => {
    const dsl = buildSearchDsl(DslQuery.parse({
      endpoint_id: "os_1",
      module: "payment-core",
      log_level: "ERROR",
      range: "last_1h",
    }));
    expect(dsl).toMatchObject({
      size: 200, from: 0,
      sort: [{ "@timestamp": { order: "desc" } }],
      track_total_hits: 10000, timeout: "30s",
    });
    expect((dsl as any).query.bool.filter).toHaveLength(3); // @timestamp + module + level
  });
});
*/
