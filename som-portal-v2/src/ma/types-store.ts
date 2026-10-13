// som-portal-v2/src/ma/types-store.ts
// Read/write ma-types.json (SM-shared).
// Port of api/ma-services/types.php.
import { readTeamFile, writeTeamFile, type Scope } from '@/team/scope';
import { getSession } from '@/auth/session';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { SM_WRITE_SHARED_ROLES } from '@/auth/policy';
import { MATypesFileSchema, type MAType, type MATypesFile } from './types';
import { readServicesFile, writeServicesFile } from './services-store';

const FILE = 'ma-types.json';

export async function readTypesFile(scope?: Scope): Promise<MATypesFile> {
  return readTeamFile(FILE, MATypesFileSchema, scope);
}

export async function writeTypesFile(data: MATypesFile, scope?: Scope): Promise<void> {
  return writeTeamFile(FILE, data, MATypesFileSchema, scope);
}

/** List service types with usage counts (v1 parity). */
export async function listServiceTypes(scope?: Scope): Promise<(MAType & { count: number })[]> {
  const [typesData, servicesData] = await Promise.all([
    readTypesFile(scope),
    readServicesFile(scope),
  ]);
  return typesData.service_types.map((t) => ({
    ...t,
    count: servicesData.services.filter((s) => s.service_type === t.name).length,
  }));
}

/** Add a new service type. */
export async function addServiceType(input: { name: string; description?: string; color?: string }): Promise<void> {
  const session = await getSession();
  if (!session || !SM_WRITE_SHARED_ROLES.includes(session.role as typeof SM_WRITE_SHARED_ROLES[number])) {
    throw new ForbiddenError('SM write required');
  }
  if (!input.name) throw new ValidationError('Name is required');

  const data = await readTypesFile();
  if (data.service_types.some((t) => t.name === input.name)) {
    throw new ValidationError('Type already exists');
  }
  data.service_types.push({
    name: input.name,
    description: input.description ?? '',
    color: input.color ?? 'gray',
  });
  await writeTypesFile(data);
}

/** Rename a service type (cascades to all services using it). */
export async function updateServiceType(input: {
  old_name: string;
  name: string;
  description?: string;
  color?: string;
}): Promise<{ updated_services: number }> {
  const session = await getSession();
  if (!session || !SM_WRITE_SHARED_ROLES.includes(session.role as typeof SM_WRITE_SHARED_ROLES[number])) {
    throw new ForbiddenError('SM write required');
  }
  if (!input.old_name || !input.name) throw new ValidationError('old_name and name required');

  const data = await readTypesFile();
  if (input.old_name !== input.name && data.service_types.some((t) => t.name === input.name)) {
    throw new ValidationError('Type name already exists');
  }
  const idx = data.service_types.findIndex((t) => t.name === input.old_name);
  if (idx < 0) throw new ValidationError('Type not found');
  data.service_types[idx] = {
    name: input.name,
    description: input.description ?? data.service_types[idx]!.description,
    color: input.color ?? data.service_types[idx]!.color,
  };
  await writeTypesFile(data);

  let updated_services = 0;
  if (input.old_name !== input.name) {
    const svcData = await readServicesFile();
    for (const svc of svcData.services) {
      if (svc.service_type === input.old_name) {
        svc.service_type = input.name;
        updated_services++;
      }
    }
    if (updated_services > 0) await writeServicesFile(svcData);
  }
  return { updated_services };
}

/** Delete a service type. */
export async function deleteServiceType(name: string): Promise<void> {
  const session = await getSession();
  if (!session || !SM_WRITE_SHARED_ROLES.includes(session.role as typeof SM_WRITE_SHARED_ROLES[number])) {
    throw new ForbiddenError('SM write required');
  }
  if (!name) throw new ValidationError('Name is required');
  const data = await readTypesFile();
  data.service_types = data.service_types.filter((t) => t.name !== name);
  await writeTypesFile(data);
}
