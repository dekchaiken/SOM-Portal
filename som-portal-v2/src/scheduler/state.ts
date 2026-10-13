// som-portal-v2/src/scheduler/state.ts
// Remembers which schedule slots already fired, so a restart or a second
// process never fires the same slot twice. Old keys are pruned.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dataDirAbsolute } from '@/lib/env';

const STATE_FILE = '.scheduler-state.json';
const KEEP_DAYS = 3;

type State = Record<string, string>; // key -> ISO time it fired

async function readState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDirAbsolute(), STATE_FILE), 'utf8')) as State;
  } catch {
    return {};
  }
}

export async function hasFired(key: string): Promise<boolean> {
  return key in (await readState());
}

export async function markFired(key: string): Promise<void> {
  const state = await readState();
  state[key] = new Date().toISOString();
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const k of Object.keys(state)) {
    if (new Date(state[k]!).getTime() < cutoff) delete state[k];
  }
  const file = path.join(dataDirAbsolute(), STATE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, file);
}
