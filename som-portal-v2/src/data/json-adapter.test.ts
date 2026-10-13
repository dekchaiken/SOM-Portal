// som-portal-v2/src/data/json-adapter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonAdapter } from './json-adapter';
import { SHARED_TEAM } from './adapter';

let tmp: string;
let adapter: JsonAdapter;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'json-adapter-'));
  adapter = new JsonAdapter(tmp);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('JsonAdapter', () => {
  it('returns null for missing files', async () => {
    const got = await adapter.read({ team: 'sm' }, 'nope.json');
    expect(got).toBeNull();
  });

  it('writes and reads a team file', async () => {
    await adapter.write({ team: 'sm' }, 'board.json', [{ id: 'x' }]);
    const got = await adapter.read<Array<{ id: string }>>({ team: 'sm' }, 'board.json');
    expect(got).toEqual([{ id: 'x' }]);
  });

  it('resolves team path under <team>/<file>', () => {
    expect(adapter.resolvePath({ team: 'sm' }, 'users.json')).toBe(
      path.join(tmp, 'sm', 'users.json'),
    );
  });

  it('shared team maps to sm/', () => {
    expect(adapter.resolvePath({ team: SHARED_TEAM }, 'jenkins.json')).toBe(
      path.join(tmp, 'sm', 'jenkins.json'),
    );
  });

  it('withLock runs the body', async () => {
    await adapter.write({ team: 'sm' }, 'x.json', { v: 1 });
    const out = await adapter.withLock({ team: 'sm' }, 'x.json', async () => 'ran');
    expect(out).toBe('ran');
  });
});
