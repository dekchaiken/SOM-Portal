// som-portal-v2/app/api/v1/jenkins-servers/route.ts
//
// Port of api/jenkins-servers/index.php. ADMIN_ROLES only, TEAM-SCOPED:
// data/<team>/jenkins_servers.json. Each team keeps its own servers and its own
// credentials, so there is no cross-team read path here at all.
//
// v1 uses PUT ?id= for updates; the brief asks for PATCH. Both are exported and
// share one handler so either client works.
import { type NextRequest } from 'next/server';
import type { ZodSchema } from 'zod';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { requirePageMode } from '@/team/features';
import { logActivity } from '@/logging/activity';
import { hostCooldownClear, hostFromUrl } from '@/jenkins/cooldown';
import { JENKINS_SERVERS_FILE } from '@/jenkins/client';
import {
  JenkinsServersFileSchema,
  ServerCreateSchema,
  ServerUpdateSchema,
  parseJobRules,
  toAdminView,
  type JenkinsServer,
} from '@/jenkins/types';
import { handle, jsonErr, jsonOk } from '@/jenkins/route-helpers';

// Zod `.default([])` makes the input and output types diverge; the generic T
// in readTeamFile picks the input type and loses the array. Cast the schema
// to a plain `JenkinsServer[]` carrier so callers get a non-nullable array.
const ServersFile = JenkinsServersFileSchema as unknown as ZodSchema<JenkinsServer[]>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** v1 page id used by requirePageMode / menu permissions. */
const PAGE_ID = 'jenkins-servers';

function genId(prefix = 'jsrv'): string {
  // Port of genId(): prefix + '_' + 12 hex chars.
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    await requireRole(...ADMIN_ROLES);
    const rows = await readTeamFile(JENKINS_SERVERS_FILE, ServersFile);
    const sorted = [...rows].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    // Creds are reduced to presence flags — v1 ships them to the browser, v2
    // does not (feedback_no_raw_data_fetch). Writes send fresh values instead.
    return jsonOk(sorted.map(toAdminView));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const sess = await requireRole(...ADMIN_ROLES);
    await requirePageMode(sess, PAGE_ID);

    const body = ServerCreateSchema.parse(await req.json());
    const existing = await readTeamFile(JENKINS_SERVERS_FILE, ServersFile);

    const created: JenkinsServer = {
      id: genId('jsrv'),
      display: body.display,
      base_url: body.base_url.replace(/\/+$/, ''),
      auth_mode: body.auth_mode,
      auth_user: body.auth_user,
      auth_token: body.auth_token,
      auth_cookie: body.auth_cookie,
      enabled: body.enabled,
      order: body.order || existing.length + 1,
      job_rules: parseJobRules(body.job_rules),
      ip_override: body.ip_override,
    };

    await writeTeamFile(
      JENKINS_SERVERS_FILE,
      [...existing, created],
      ServersFile,
    );

    // Wipe any stale cooldown so a fresh IP override probes immediately rather
    // than waiting out the previous failure (v1 does the same).
    if (created.ip_override !== '') {
      await hostCooldownClear(hostFromUrl(created.base_url));
    }

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'jenkins_server_create',
      meta: { id: created.id, display: created.display },
    });
    return jsonOk(toAdminView(created), 201);
  });
}

async function update(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const sess = await requireRole(...ADMIN_ROLES);
    await requirePageMode(sess, PAGE_ID);

    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return jsonErr('Server ID required', 400);

    // Validate up front so we never half-apply a patch (v1 comment).
    const patch = ServerUpdateSchema.parse(await req.json());
    const rows = await readTeamFile(JENKINS_SERVERS_FILE, ServersFile);

    let touchedHost = '';
    let found = false;
    const next = rows.map((s) => {
      if (s.id !== id) return s;
      found = true;
      const m: JenkinsServer = { ...s };
      if (patch.display !== undefined) m.display = patch.display;
      if (patch.base_url !== undefined) m.base_url = patch.base_url.replace(/\/+$/, '');
      if (patch.auth_mode !== undefined) m.auth_mode = patch.auth_mode;
      if (patch.auth_user !== undefined) m.auth_user = patch.auth_user;
      if (patch.auth_token !== undefined) m.auth_token = patch.auth_token;
      if (patch.auth_cookie !== undefined) m.auth_cookie = patch.auth_cookie;
      if (patch.enabled !== undefined) m.enabled = patch.enabled;
      if (patch.order !== undefined) m.order = patch.order;
      if (patch.ip_override !== undefined) m.ip_override = patch.ip_override;
      if (patch.job_rules !== undefined) m.job_rules = parseJobRules(patch.job_rules);
      touchedHost = hostFromUrl(m.base_url);
      return m;
    });

    if (!found) return jsonErr('Server not found', 404);
    await writeTeamFile(JENKINS_SERVERS_FILE, next, ServersFile);
    if (touchedHost !== '') await hostCooldownClear(touchedHost);

    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'jenkins_server_update',
      meta: { id },
    });
    return jsonOk(null);
  });
}

export const PATCH = update;
export const PUT = update;

export async function DELETE(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const sess = await requireRole(...ADMIN_ROLES);
    await requirePageMode(sess, PAGE_ID);

    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return jsonErr('Server ID required', 400);

    const rows = await readTeamFile(JENKINS_SERVERS_FILE, ServersFile);
    const filtered = rows.filter((s) => s.id !== id);
    if (filtered.length === rows.length) return jsonErr('Server not found', 404);

    await writeTeamFile(JENKINS_SERVERS_FILE, filtered, ServersFile);
    await logActivity({
      user: sess.sub,
      team: sess.team,
      action: 'jenkins_server_delete',
      meta: { id },
    });
    return jsonOk(null);
  });
}
