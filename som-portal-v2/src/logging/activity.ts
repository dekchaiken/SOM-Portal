// som-portal-v2/src/logging/activity.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDirAbsolute } from '@/lib/env';

export interface ActivityEntry {
  ts: string;
  user: string | null;
  team: string | null;
  action: string;
  meta?: Record<string, unknown>;
}

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(dataDirAbsolute(), 'logs', `activity-${yyyy}-${mm}-${dd}.jsonl`);
}

export async function logActivity(entry: Omit<ActivityEntry, 'ts'>): Promise<void> {
  const file = todayFile();
  const full: ActivityEntry = { ts: new Date().toISOString(), ...entry };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(full) + '\n', 'utf8');
}
