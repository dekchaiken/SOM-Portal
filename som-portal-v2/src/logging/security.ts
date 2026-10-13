// som-portal-v2/src/logging/security.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDirAbsolute } from '@/lib/env';

export interface SecurityEntry {
  ts: string;
  user: string | null;
  team: string | null;
  event: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(dataDirAbsolute(), 'logs', `security-${yyyy}-${mm}-${dd}.jsonl`);
}

export async function logSecurity(entry: Omit<SecurityEntry, 'ts'>): Promise<void> {
  const file = todayFile();
  const full: SecurityEntry = { ts: new Date().toISOString(), ...entry };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(full) + '\n', 'utf8');
}
