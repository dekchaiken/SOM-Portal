// som-portal-v2/playwright/mail-team.spec.ts
// Team mailboxes: a team sends only from its own config, and only super_admin can
// read or change another team's config.
import { test, expect, type APIRequestContext } from '@playwright/test';

const PASSWORD = 'Test1234!';

async function login(request: APIRequestContext, username: string) {
  const res = await request.post('/v2/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.ok(), `login ${username}`).toBeTruthy();
}

test.describe('team mailboxes (TC-MAIL-TEAM)', () => {
  test('a team with no mailbox cannot send, and the log says why', async ({ request }) => {
    await login(request, 'qa.devadmin');
    const res = await request.post('/v2/api/mail/send', {
      data: { to: ['a@test.local'], subject: `qa-nobox-${Date.now()}`, body: 'x' },
    });
    const body = await res.json();
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toContain('no mailbox');
  });

  test('a team sends from its own config', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const res = await request.post('/v2/api/mail/send', {
      data: { to: ['a@test.local'], subject: 'qa own mailbox', body: 'x' },
    });
    expect((await res.json()).data.ok).toBe(true);
  });

  test('a team admin cannot read another team\'s mailbox config', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const res = await request.get('/v2/api/mail/config?team=ss');
    expect(res.status()).toBe(403);
  });

  test('super_admin lists teams and reads another team\'s config', async ({ request }) => {
    await login(request, 'qa.super');
    const teams = (await (await request.get('/v2/api/mail/teams')).json()).data as Array<{ slug: string }>;
    expect(teams.map((t) => t.slug)).toContain('ss');
    const cfg = (await (await request.get('/v2/api/mail/config?team=ss')).json()).data;
    expect(cfg.team).toBe('ss');
    expect(cfg).not.toHaveProperty('smtp_password', expect.stringMatching(/.+/));
  });

  test('the team list is not visible to a team admin', async ({ request }) => {
    await login(request, 'qa.smadmin');
    const res = await request.get('/v2/api/mail/teams');
    expect(res.status()).toBe(403);
  });
});
