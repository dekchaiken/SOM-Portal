// som-portal-v2/src/admin/users-service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session } from '@/auth/session';
import { __setDataAdapter } from '@/data/json-adapter';
import type { DataAdapter, TeamScope } from '@/data/adapter';

vi.mock('@/logging/activity', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/logging/security', () => ({ logSecurity: vi.fn(async () => undefined) }));

import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  generateTempPassword,
  validatePasswordPolicy,
  maskEmail,
  genId,
  assignableRoles,
} from './users-service';
import { verifyPassword } from '@/auth/password';

// ─── in-memory adapter standing in for data/*.json ───────────────────────────
class MemoryAdapter implements DataAdapter {
  files = new Map<string, unknown>();
  key(scope: TeamScope, file: string) {
    return `${scope.team}/${file}`;
  }
  async read<T>(scope: TeamScope, file: string): Promise<T | null> {
    const v = this.files.get(this.key(scope, file));
    return (v === undefined ? null : structuredClone(v)) as T | null;
  }
  async write<T>(scope: TeamScope, file: string, data: T): Promise<void> {
    this.files.set(this.key(scope, file), structuredClone(data));
  }
  async withLock<T>(_s: TeamScope, _f: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  resolvePath(scope: TeamScope, file: string): string {
    return this.key(scope, file);
  }
}

const mem = new MemoryAdapter();

function sess(role: string, team = 'sm', sub = 'usr_admin'): Session {
  return { sub, username: 'tester', role, team };
}

const SM_ADMIN = sess('sm_admin');
const SUPER = sess('super_admin', 'sm', 'usr_super');

const SEED = [
  { id: 'usr_a', name: 'Alice SM', username: 'alice', email: 'alice@x.com', role: 'sm_user', team: 'sm', password: 'hash-a' },
  { id: 'usr_b', name: 'Bob SS', username: 'bob', email: 'bob@x.com', role: 'sm_user', team: 'ss', password: 'hash-b' },
  { id: 'usr_d', name: 'Dana Dev', username: 'dana', email: 'dana@x.com', role: 'dev_user', team: 'dev', password: 'hash-d' },
  { id: 'usr_admin', name: 'Admin SM', username: 'tester', email: 'admin@x.com', role: 'sm_admin', team: 'sm', password: 'hash-x' },
  { id: 'usr_hidden', name: 'Hidden', username: 'hidden', email: 'h@x.com', role: 'sm_user', team: 'sm', password: 'h', schedule_include: false },
];

const TEAMS = [
  { id: 'tm1', slug: 'sm', name: 'SM Team', active: true },
  { id: 'tm2', slug: 'ss', name: 'SS Team', active: true },
  { id: 'tm3', slug: 'dev', name: 'Dev Team', active: true },
  { id: 'tm4', slug: 'old', name: 'Retired', active: false },
];

beforeEach(() => {
  mem.files.clear();
  mem.files.set('/users.json', structuredClone(SEED));
  mem.files.set('/teams.json', structuredClone(TEAMS));
  mem.files.set('/system-settings.json', { password_history_count: 3 });
  __setDataAdapter(mem);
});

function users() {
  return mem.files.get('/users.json') as Record<string, unknown>[];
}

describe('v1 helper parity', () => {
  it('genId matches v1 `prefix_12hex`', () => {
    expect(genId('usr')).toMatch(/^usr_[0-9a-f]{12}$/);
  });

  it('temp password matches v1 SOM_ format and the v2 policy', () => {
    for (let i = 0; i < 50; i += 1) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/^SOM_[A-Z2-9]{6}$/);
      expect(validatePasswordPolicy(pw)).toBeNull();
    }
  });

  it('password policy requires 10 chars + upper + digit', () => {
    expect(validatePasswordPolicy('short1A')).toMatch(/10 characters/);
    expect(validatePasswordPolicy('alllowercase1')).toMatch(/uppercase/);
    expect(validatePasswordPolicy('ALLLETTERSHERE')).toMatch(/digit/);
    expect(validatePasswordPolicy('Password123')).toBeNull();
  });

  it('masks emails like v1 _maskEmailForDisplay', () => {
    expect(maskEmail('warapon@ascendcorp.com')).toBe('w*****n@ascendcorp.com');
    expect(maskEmail('ab@x.com')).toBe('**@x.com');
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('multi-team read scoping', () => {
  it('sm_admin sees only its own team', async () => {
    const res = await listUsers(SM_ADMIN);
    const names = res.users.map((u) => u.id);
    expect(names).toContain('usr_a');
    expect(names).not.toContain('usr_b');
    expect(res.team).toBe('sm');
  });

  it('sm_admin may view the shared dev team explicitly', async () => {
    const res = await listUsers(SM_ADMIN, { team: 'dev' });
    expect(res.users.map((u) => u.id)).toEqual(['usr_d']);
  });

  it('sm_admin asking for another team is refused', async () => {
    await expect(listUsers(SM_ADMIN, { team: 'ss' })).rejects.toThrow(/super_admin/);
  });

  it('super_admin sees every team, and can narrow', async () => {
    const all = await listUsers(SUPER);
    expect(all.users).toHaveLength(SEED.length);
    expect(all.team).toBeNull();
    const narrowed = await listUsers(SUPER, { team: 'ss' });
    expect(narrowed.users.map((u) => u.id)).toEqual(['usr_b']);
  });

  it('sm_user gets the minimal schedule projection of its own team', async () => {
    const res = await listUsers(sess('sm_user', 'sm', 'usr_a'));
    const row = res.users[0] as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['id', 'name', 'nickname', 'role']);
    // schedule_include:false is filtered out, like v1
    expect(res.users.map((u) => u.id)).not.toContain('usr_hidden');
    expect(res.can_manage).toBe(false);
  });

  it('never leaks password or password_history', async () => {
    const res = await listUsers(SUPER);
    for (const u of res.users) {
      expect(u).not.toHaveProperty('password');
      expect(u).not.toHaveProperty('password_history');
    }
  });
});

describe('role grant caps', () => {
  it('sm_admin may only assign sm_user / sm_admin / dev_user', () => {
    expect(assignableRoles(SM_ADMIN)).toEqual(['sm_user', 'sm_admin', 'dev_user']);
    expect(assignableRoles(SUPER)).toContain('super_viewer');
    expect(assignableRoles(sess('sm_user'))).toEqual([]);
  });

  it('sm_admin cannot create an sm_lead', async () => {
    await expect(
      createUser(SM_ADMIN, {
        name: 'X',
        username: 'x.lead',
        email: 'x@x.com',
        role: 'sm_lead',
      }),
    ).rejects.toThrow(/User, Admin, or Dev User/);
  });

  it('only super_admin can create super_viewer', async () => {
    await expect(
      createUser(SM_ADMIN, {
        name: 'X',
        username: 'x.view',
        email: 'x@x.com',
        role: 'super_viewer',
      }),
    ).rejects.toThrow(/super_admin/);
  });

  it('sm_user cannot create at all', async () => {
    await expect(
      createUser(sess('sm_user'), {
        name: 'X',
        username: 'x',
        email: 'x@x.com',
        role: 'sm_user',
      }),
    ).rejects.toThrow(/insufficient permissions/);
  });
});

describe('createUser', () => {
  it('creates in the admin own team with a bcrypt hash and v1 fields', async () => {
    const res = await createUser(SM_ADMIN, {
      name: 'New Person',
      username: 'new.person',
      email: 'new.person@ascendcorp.com',
      role: 'sm_user',
      nickname: 'NP',
    });
    expect(res.user.team).toBe('sm');
    expect(res.generated).toBe(true);
    expect(res.user).not.toHaveProperty('password');

    const raw = users().find((u) => u.username === 'new.person')!;
    expect(String(raw.password)).toMatch(/^\$2[aby]\$/);
    await expect(verifyPassword(res.temp_password, String(raw.password))).resolves.toBe(true);
    expect(raw.first_login).toBe(true);
    expect(raw.must_reset_password).toBe(true);
    expect(raw.password_history).toEqual([]);
    expect(raw.created_by).toBe('usr_admin');
    expect(String(raw.id)).toMatch(/^usr_[0-9a-f]{12}$/);
    // v1 default inclusion toggles
    expect(raw.schedule_include).toBe(true);
    expect(raw.course_include).toBe(true);
    expect(raw.exam_include).toBe(true);
  });

  it('rejects a duplicate username case-insensitively', async () => {
    await expect(
      createUser(SM_ADMIN, {
        name: 'Dup',
        username: 'ALICE',
        email: 'dup@x.com',
        role: 'sm_user',
      }),
    ).rejects.toThrow(/Username already exists/);
    expect(users()).toHaveLength(SEED.length);
  });

  it('requires a valid email', async () => {
    await expect(
      createUser(SM_ADMIN, { name: 'E', username: 'e.e', email: 'nope', role: 'sm_user' }),
    ).rejects.toThrow(/valid email/);
  });

  it('super_admin must name an active team', async () => {
    await expect(
      createUser(SUPER, { name: 'T', username: 't.t', email: 't@x.com', role: 'sm_user' }),
    ).rejects.toThrow(/team is required/);
    await expect(
      createUser(SUPER, {
        name: 'T',
        username: 't.t',
        email: 't@x.com',
        role: 'sm_user',
        team: 'old',
      }),
    ).rejects.toThrow(/not found or inactive/);
    const okRes = await createUser(SUPER, {
      name: 'T',
      username: 't.t',
      email: 't@x.com',
      role: 'sm_user',
      team: 'ss',
    });
    expect(okRes.user.team).toBe('ss');
  });

  it('dev_user is always homed to the dev team; super_viewer has no team', async () => {
    const dev = await createUser(SM_ADMIN, {
      name: 'D',
      username: 'd.dev',
      email: 'd@x.com',
      role: 'dev_user',
      dev_subteam: 'wallet',
    });
    expect(dev.user.team).toBe('dev');
    expect(dev.user.dev_subteam).toBe('wallet');
    expect(dev.user.schedule_include).toBe(false);

    const viewer = await createUser(SUPER, {
      name: 'V',
      username: 'v.view',
      email: 'v@x.com',
      role: 'super_viewer',
    });
    expect(viewer.user.team).toBeNull();
  });

  it('honours an admin-supplied password that meets the policy', async () => {
    await expect(
      createUser(SM_ADMIN, {
        name: 'P',
        username: 'p.weak',
        email: 'p@x.com',
        role: 'sm_user',
        password: 'weak',
      }),
    ).rejects.toThrow(/at least 10/);
    const res = await createUser(SM_ADMIN, {
      name: 'P',
      username: 'p.strong',
      email: 'p@x.com',
      role: 'sm_user',
      password: 'Str0ngPassword',
    });
    expect(res.generated).toBe(false);
    expect(res.temp_password).toBe('Str0ngPassword');
  });
});

describe('updateUser', () => {
  it('updates identity fields of an own-team user', async () => {
    const res = await updateUser(SM_ADMIN, 'usr_a', { name: 'Alice Renamed', phone: '0812345678' });
    expect(res.name).toBe('Alice Renamed');
    expect(res.phone).toBe('0812345678');
    expect(res).not.toHaveProperty('password');
    // untouched fields survive
    expect(users().find((u) => u.id === 'usr_a')!.password).toBe('hash-a');
  });

  it('refuses a cross-team write for a team admin', async () => {
    await expect(updateUser(SM_ADMIN, 'usr_b', { name: 'nope' })).rejects.toThrow(
      /your own team/,
    );
    expect(users().find((u) => u.id === 'usr_b')!.name).toBe('Bob SS');
  });

  it('lets super_admin write across teams', async () => {
    const res = await updateUser(SUPER, 'usr_b', { name: 'Bob Edited' });
    expect(res.name).toBe('Bob Edited');
  });

  it('refuses a role grant above the admin own level', async () => {
    await expect(updateUser(SM_ADMIN, 'usr_a', { role: 'dev_sm' })).rejects.toThrow(
      /User, Admin, or Dev User/,
    );
  });

  it('refuses self-demotion out of admin', async () => {
    await expect(updateUser(SM_ADMIN, 'usr_admin', { role: 'sm_user' })).rejects.toThrow(
      /your own role/,
    );
  });

  it('re-homes a user to the dev team when promoted to dev_user', async () => {
    const res = await updateUser(SM_ADMIN, 'usr_a', { role: 'dev_user' });
    expect(res.team).toBe('dev');
  });

  it('enforces contact field caps and avatar format', async () => {
    await expect(updateUser(SM_ADMIN, 'usr_a', { emp_id: '1'.repeat(21) })).rejects.toThrow(
      /too long/,
    );
    await expect(
      updateUser(SM_ADMIN, 'usr_a', { avatar_url: 'ftp://evil/x.png' }),
    ).rejects.toThrow(/Invalid avatar format/);
    const res = await updateUser(SM_ADMIN, 'usr_a', {
      avatar_url: 'https://cdn.example.com/a.png',
    });
    expect(res.avatar_url).toBe('https://cdn.example.com/a.png');
  });

  it('extra_pages is super_admin only', async () => {
    await expect(
      updateUser(SM_ADMIN, 'usr_a', { extra_pages: [{ page: 'board', source_team: 'ss' }] }),
    ).rejects.toThrow(/super_admin/);
    const res = await updateUser(SUPER, 'usr_a', {
      extra_pages: [
        { page: 'board', source_team: 'ss' },
        { page: 'bad', source_team: 'BAD SLUG' },
      ],
    });
    expect(res.extra_pages).toEqual([{ page: 'board', source_team: 'ss' }]);
  });
});

describe('deleteUser', () => {
  it('soft-deletes by default and hides the record from listings', async () => {
    const res = await deleteUser(SM_ADMIN, 'usr_a');
    expect(res.mode).toBe('soft');
    const raw = users().find((u) => u.id === 'usr_a')!;
    expect(raw.deleted_at).toBeTruthy();
    expect(raw.deleted_by).toBe('usr_admin');
    expect(raw.password_expired).toBe(true);
    const list = await listUsers(SM_ADMIN);
    expect(list.users.map((u) => u.id)).not.toContain('usr_a');
    const withDeleted = await listUsers(SM_ADMIN, { includeDeleted: true });
    expect(withDeleted.users.map((u) => u.id)).toContain('usr_a');
  });

  it('refuses self-deletion and cross-team deletion', async () => {
    await expect(deleteUser(SM_ADMIN, 'usr_admin')).rejects.toThrow(/your own account/);
    await expect(deleteUser(SM_ADMIN, 'usr_b')).rejects.toThrow(/your own team/);
  });

  it('hard delete is super_admin only and purges the record (v1 behaviour)', async () => {
    await expect(deleteUser(SM_ADMIN, 'usr_a', { hard: true })).rejects.toThrow(
      /super_admin/,
    );
    const res = await deleteUser(SUPER, 'usr_a', { hard: true });
    expect(res.mode).toBe('hard');
    expect(users().find((u) => u.id === 'usr_a')).toBeUndefined();
  });
});

describe('resetUserPassword', () => {
  it('rotates the hash, pushes history and forces a change', async () => {
    const res = await resetUserPassword(SM_ADMIN, 'usr_a', 3);
    expect(res.temp_password).toMatch(/^SOM_[A-Z2-9]{6}$/);
    expect(res.masked_email).toBe('a***e@x.com');
    const raw = users().find((u) => u.id === 'usr_a')!;
    await expect(verifyPassword(res.temp_password, String(raw.password))).resolves.toBe(true);
    expect(raw.password_history).toEqual(['hash-a']);
    expect(raw.must_reset_password).toBe(true);
    expect(raw.password_expired).toBe(false);
  });

  it('caps password_history at the configured count', async () => {
    const list = users();
    list[0]!.password_history = ['h1', 'h2', 'h3'];
    mem.files.set('/users.json', list);
    await resetUserPassword(SM_ADMIN, 'usr_a', 3);
    expect(users().find((u) => u.id === 'usr_a')!.password_history).toHaveLength(3);
  });

  it('refuses a cross-team reset', async () => {
    await expect(resetUserPassword(SM_ADMIN, 'usr_b')).rejects.toThrow(/your own team/);
  });
});
