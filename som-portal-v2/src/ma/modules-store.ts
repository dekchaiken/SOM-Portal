// som-portal-v2/src/ma/modules-store.ts
// Read/write ma-modules.json (SM-shared).
import { readTeamFile, type Scope } from '@/team/scope';
import { MAModulesFileSchema, type MAModule } from './types';

const FILE = 'ma-modules.json';

export async function listModules(scope?: Scope): Promise<MAModule[]> {
  const data = await readTeamFile(FILE, MAModulesFileSchema, scope);
  return [...data.modules]
    .filter((m) => m.enabled)
    .sort((a, b) => a.order - b.order);
}
