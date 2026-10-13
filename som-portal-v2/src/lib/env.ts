// som-portal-v2/src/lib/env.ts
import { z } from 'zod';
// IMPORTANT: no top-level `node:*` imports — this module is pulled into the Edge runtime
// (via auth/session → middleware). Lazy-require inside functions that need Node-only APIs.

const EnvSchema = z.object({
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JIRA_EMAIL: z.string().optional().default(''),
  JIRA_TOKEN: z.string().optional().default(''),
  OPENSEARCH_CREDS_KEY: z.string().optional().default(''),
  DATA_DIR: z.string().default('../data'),
  // Soft URL check: default to localhost; only validate if a non-empty value was passed.
  BASE_URL: z
    .string()
    .default('http://localhost:3000')
    .refine((v) => {
      try { new URL(v); return true; } catch { return false; }
    }, 'BASE_URL must be a valid URL'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // Drop empty strings so Zod `.default()` kicks in.
  // Also drop BASE_URL if it's not a parsable URL — Vitest/Vite sets BASE_URL="/" by default.
  const filtered = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => {
      if (v === undefined || v === '') return false;
      if (k === 'BASE_URL') {
        try { new URL(v); return true; } catch { return false; }
      }
      return true;
    }),
  );
  const parsed = EnvSchema.safeParse(filtered);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}

export function dataDirAbsolute(): string {
  const e = env();
  // Lazy node:path import keeps this module edge-bundle-safe.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  return path.isAbsolute(e.DATA_DIR) ? e.DATA_DIR : path.resolve(process.cwd(), e.DATA_DIR);
}

// Test-only reset.
export function __resetEnvCache(): void {
  cached = null;
}
