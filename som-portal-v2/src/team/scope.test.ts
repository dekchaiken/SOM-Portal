// som-portal-v2/src/team/scope.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Session } from '@/auth/session';

let currentSession: Session | null = null;

vi.mock('@/auth/session', async () => {
  const actual = await vi.importActual<typeof import('@/auth/session')>('@/auth/session');
  return {
    ...actual,
    getSession: async (): Promise<Session | null> => currentSession,
  };
});

vi.mock('@/logging/security', () => ({
  logSecurity: vi.fn().mockResolvedValue(undefined),
}));

import { JsonAdapter } from '@/data/json-adapter';
import { __setDataAdapter } from '@/data/json-adapter';
import {
  readTeamFile,
  writeTeamFile,
  readSharedFile,
  writeSharedFile,
} from './scope';

const Schema = z.array(z.object({ id: z.string() })).default([]);

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scope-'));
  __setDataAdapter(new JsonAdapter(tmp));
  currentSession = {
    sub: 'u1',
    username: 'alice',
    role: 'sm_user',
    team: 'sm',
  };
});

afterEach(async () => {
  __setDataAdapter(null);
  currentSession = null;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('team/scope', () => {
  it('readTeamFile reads from the session team', async () => {
    await fs.mkdir(path.join(tmp, 'sm'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'sm', 'board.json'), JSON.stringify([{ id: 'a' }]));
    const out = await readTeamFile('board.json', Schema);
    expect(out).toEqual([{ id: 'a' }]);
  });

  it('writeTeamFile writes under team dir', async () => {
    await writeTeamFile('board.json', [{ id: 'b' }], Schema);
    const got = JSON.parse(await fs.readFile(path.join(tmp, 'sm', 'board.json'), 'utf8'));
    expect(got).toEqual([{ id: 'b' }]);
  });

  it('cross-team denied for non-super_admin', async () => {
    await expect(readTeamFile('x.json', Schema, { team: 'dev' })).rejects.toThrow(/super_admin/);
  });

  it('cross-team allowed for super_admin', async () => {
    currentSession = { sub: 'root', username: 'r', role: 'super_admin', team: 'sm' };
    await fs.mkdir(path.join(tmp, 'dev'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'dev', 'x.json'), JSON.stringify([{ id: 'z' }]));
    const out = await readTeamFile('x.json', Schema, { team: 'dev' });
    expect(out).toEqual([{ id: 'z' }]);
  });

  it('writeSharedFile requires sm_* role', async () => {
    currentSession = { sub: 'd', username: 'd', role: 'dev_user', team: 'dev' };
    await expect(writeSharedFile('shared.json', [{ id: 'q' }], Schema)).rejects.toThrow(/sm_/);
  });

  it('writeSharedFile allowed for sm_admin, lands in sm/', async () => {
    currentSession = { sub: 'a', username: 'a', role: 'sm_admin', team: 'sm' };
    await writeSharedFile('shared.json', [{ id: 'q' }], Schema);
    const got = JSON.parse(await fs.readFile(path.join(tmp, 'sm', 'shared.json'), 'utf8'));
    expect(got).toEqual([{ id: 'q' }]);
  });

  it('readSharedFile reads from sm/', async () => {
    await fs.mkdir(path.join(tmp, 'sm'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'sm', 'shared.json'), JSON.stringify([{ id: 's' }]));
    const out = await readSharedFile('shared.json', Schema);
    expect(out).toEqual([{ id: 's' }]);
  });

  it('readTeamFile returns schema default on missing', async () => {
    const out = await readTeamFile('nope.json', Schema);
    expect(out).toEqual([]);
  });
});
