// som-portal-v2/src/ma/services-store.ts
// CRUD for ma-services.json — SM-shared file (team-scoped via readTeamFile).
// Port of api/ma-services/{list,create,update,delete}.php.
import { readTeamFile, writeTeamFile, type Scope } from '@/team/scope';
import { logActivity } from '@/logging/activity';
import { getSession, type Session } from '@/auth/session';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { SM_WRITE_SHARED_ROLES } from '@/auth/policy';
import {
  MAServicesFileSchema,
  CreateMAServiceInput,
  UpdateMAServiceInput,
  type MAService,
  type MAServicesFile,
} from './types';

const FILE = 'ma-services.json';

function requireSmWrite(session: Session): void {
  if (!SM_WRITE_SHARED_ROLES.includes(session.role as typeof SM_WRITE_SHARED_ROLES[number])) {
    throw new ForbiddenError('SM team write access required');
  }
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').slice(0, 19);
}

export async function readServicesFile(scope?: Scope): Promise<MAServicesFile> {
  return readTeamFile(FILE, MAServicesFileSchema, scope);
}

export async function writeServicesFile(data: MAServicesFile, scope?: Scope): Promise<void> {
  return writeTeamFile(FILE, data, MAServicesFileSchema, scope);
}

export async function listServices(scope?: Scope): Promise<MAService[]> {
  const data = await readServicesFile(scope);
  return [...data.services].sort((a, b) => a.id - b.id);
}

export async function getService(id: number, scope?: Scope): Promise<MAService> {
  const data = await readServicesFile(scope);
  const svc = data.services.find((s) => s.id === id);
  if (!svc) throw new NotFoundError('Service not found');
  return svc;
}

export async function createService(input: unknown): Promise<MAService> {
  const session = await getSession();
  if (!session) throw new ForbiddenError('Not authenticated');
  requireSmWrite(session);

  const parsed = CreateMAServiceInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  const body = parsed.data;
  const data = await readServicesFile();
  const ts = now();

  const newService: MAService = {
    id: data.next_id,
    service_name: body.service_name,
    service_type: body.service_type,
    tool_type: body.tool_type,
    can_change_text: body.can_change_text,
    remark: body.remark,
    link_manual: body.link_manual,
    direct_link: body.direct_link,
    custom_url: body.custom_url,
    grafana_link: body.grafana_link,
    opensearch_url: body.opensearch_url,
    images: body.images,
    backoffice_use_case_id: body.backoffice_use_case_id,
    jenkins_server_id: body.jenkins_server_id,
    jenkins_job_path: body.jenkins_job_path,
    created_at: ts,
    updated_at: ts,
  };

  data.services.push(newService);
  data.next_id++;
  await writeServicesFile(data);

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'ma_service_create',
    meta: { id: newService.id, service_name: newService.service_name },
  });

  return newService;
}

export async function updateService(input: unknown): Promise<MAService> {
  const session = await getSession();
  if (!session) throw new ForbiddenError('Not authenticated');
  requireSmWrite(session);

  const parsed = UpdateMAServiceInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  const body = parsed.data;
  const data = await readServicesFile();

  const idx = data.services.findIndex((s) => s.id === body.id);
  if (idx < 0) throw new NotFoundError('Service not found');

  const svc = data.services[idx]!;

  if (body.service_name !== undefined) svc.service_name = body.service_name;
  if (body.service_type !== undefined) svc.service_type = body.service_type;
  if (body.tool_type !== undefined) svc.tool_type = body.tool_type;
  if (body.can_change_text !== undefined) svc.can_change_text = body.can_change_text;
  if (body.remark !== undefined) svc.remark = body.remark;
  if (body.link_manual !== undefined) svc.link_manual = body.link_manual;
  if (body.direct_link !== undefined) svc.direct_link = body.direct_link;
  if (body.custom_url !== undefined) svc.custom_url = body.custom_url;
  if (body.grafana_link !== undefined) svc.grafana_link = body.grafana_link;
  if (body.opensearch_url !== undefined) svc.opensearch_url = body.opensearch_url;
  if (body.images !== undefined) svc.images = body.images;
  if (body.backoffice_use_case_id !== undefined) svc.backoffice_use_case_id = body.backoffice_use_case_id;
  if (body.jenkins_server_id !== undefined) svc.jenkins_server_id = body.jenkins_server_id;
  if (body.jenkins_job_path !== undefined) svc.jenkins_job_path = body.jenkins_job_path;
  svc.updated_at = now();

  data.services[idx] = svc;
  await writeServicesFile(data);

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'ma_service_update',
    meta: { id: svc.id, service_name: svc.service_name },
  });

  return svc;
}

export async function deleteService(id: number): Promise<void> {
  const session = await getSession();
  if (!session) throw new ForbiddenError('Not authenticated');
  requireSmWrite(session);

  const data = await readServicesFile();
  const idx = data.services.findIndex((s) => s.id === id);
  if (idx < 0) throw new NotFoundError('Service not found');

  const removed = data.services[idx]!;
  data.services.splice(idx, 1);
  await writeServicesFile(data);

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'ma_service_delete',
    meta: { id: removed.id, service_name: removed.service_name },
  });
}

/** Update service record after a toggle/trigger — internal, already authed. */
export async function patchServiceRecord(
  id: number,
  patch: Partial<MAService>,
): Promise<void> {
  const data = await readServicesFile();
  const idx = data.services.findIndex((s) => s.id === id);
  if (idx < 0) return; // silent — record may have been deleted
  data.services[idx] = { ...data.services[idx]!, ...patch, updated_at: now() };
  await writeServicesFile(data);
}
