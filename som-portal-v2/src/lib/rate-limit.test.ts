// som-portal-v2/src/lib/rate-limit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileRateLimitBackend } from './rate-limit';

let tmp: string;
let file: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rl-'));
  file = path.join(tmp, 'rate_limit.json');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('FileRateLimitBackend', () => {
  it('allows up to limit then rejects', async () => {
    const rl = new FileRateLimitBackend(file);
    for (let i = 0; i < 3; i++) {
      const r = await rl.check('login:1.1.1.1', 3, 60);
      expect(r.ok).toBe(true);
    }
    const r = await rl.check('login:1.1.1.1', 3, 60);
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('separates buckets', async () => {
    const rl = new FileRateLimitBackend(file);
    await rl.check('a', 1, 60);
    const r = await rl.check('b', 1, 60);
    expect(r.ok).toBe(true);
  });

  it('resets after window', async () => {
    const rl = new FileRateLimitBackend(file);
    await rl.check('x', 1, 1); // 1-second window via windowSec
    // Force past the window by rewriting resetAt to the past.
    const store = JSON.parse(await fs.readFile(file, 'utf8')) as Record<
      string,
      { count: number; resetAt: number }
    >;
    const entry = store['x'];
    expect(entry).toBeDefined();
    if (entry) entry.resetAt = Date.now() - 1000;
    await fs.writeFile(file, JSON.stringify(store));
    const r = await rl.check('x', 1, 60);
    expect(r.ok).toBe(true);
  });
});
