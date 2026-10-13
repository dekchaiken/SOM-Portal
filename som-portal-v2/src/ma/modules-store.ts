// som-portal-v2/src/ma/modules-store.ts
// Read/write ma-modules.json (SM-shared).
import { readSharedFile } from '@/team/scope';
import { MAModulesFileSchema, type MAModule } from './types';

const FILE = 'ma-modules.json';

export async function listModules(): Promise<MAModule[]> {
  const data = await readSharedFile(FILE, MAModulesFileSchema);
  return [...data.modules]
    .filter((m) => m.enabled)
    .sort((a, b) => a.order - b.order);
}
