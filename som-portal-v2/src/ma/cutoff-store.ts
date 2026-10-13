// som-portal-v2/src/ma/cutoff-store.ts
// Cut-off services (data/sm/cutoff-services.json). SM team data: the SM team and
// super_admin write, every other team reads. Same record fields as v1.
import { z } from 'zod';
import { readSharedFile, writeSharedFile } from '@/team/scope';
import { getSession } from '@/auth/session';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { canEditMASharedData } from './access';

const FILE = 'cutoff-services.json';

export const CutoffRecordSchema = z
  .object({
    id: z.number(),
    site_type: z.string().default(''),
    service_name: z.string().default(''),
    service_group: z.string().default(''),
    channel: z.string().default(''),
    bank_name: z.string().default(''),
    bank_certificate: z.string().default(''),
    tmn_certificate: z.string().default(''),
    comcode: z.string().default(''),
    cutoff_day: z.string().default(''),
    cutoff_time: z.string().default(''),
    ma_page: z.string().default(''),
    remark: z.string().default(''),
    created_at: z.string().default(''),
    updated_at: z.string().default(''),
  })
  .passthrough();
export type CutoffRecord = z.infer<typeof CutoffRecordSchema>;

export const CutoffFileSchema = z.object({ cutoffs: z.array(CutoffRecordSchema).default([]), next_id: z.number().default(1) }).passthrough();
type CutoffFile = z.infer<typeof CutoffFileSchema>;

export const CutoffInputSchema = CutoffRecordSchema.omit({ id: true, created_at: true, updated_at: true }).partial().extend({
  service_name: z.string().min(1, 'service_name is required'),
});

function now(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').slice(0, 19);
}

async function requireWriter(): Promise<void> {
  const session = await getSession();
  if (!session) throw new ForbiddenError('Not authenticated');
  if (!canEditMASharedData(session)) {
    throw new ForbiddenError('Only the SM team can change cut-off services. Other teams have view-only access.');
  }
}

export async function listCutoffs(): Promise<CutoffRecord[]> {
  const file = await readSharedFile(FILE, CutoffFileSchema);
  return [...file.cutoffs].sort((a, b) => a.id - b.id);
}

export async function createCutoff(input: unknown): Promise<CutoffRecord> {
  await requireWriter();
  const parsed = CutoffInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
  const file: CutoffFile = await readSharedFile(FILE, CutoffFileSchema);
  const ts = now();
  const rec: CutoffRecord = {
    ...CutoffRecordSchema.parse({ id: file.next_id, ...parsed.data }),
    created_at: ts,
    updated_at: ts,
  };
  await writeSharedFile(FILE, { ...file, cutoffs: [...file.cutoffs, rec], next_id: file.next_id + 1 }, CutoffFileSchema);
  return rec;
}

export async function updateCutoff(id: number, input: unknown): Promise<CutoffRecord> {
  await requireWriter();
  const parsed = CutoffInputSchema.partial().safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
  const file: CutoffFile = await readSharedFile(FILE, CutoffFileSchema);
  const idx = file.cutoffs.findIndex((c) => c.id === id);
  if (idx === -1) throw new NotFoundError('Cut-off service not found');
  const next = { ...file.cutoffs[idx]!, ...parsed.data, id, updated_at: now() } as CutoffRecord;
  const cutoffs = file.cutoffs.map((c, i) => (i === idx ? next : c));
  await writeSharedFile(FILE, { ...file, cutoffs }, CutoffFileSchema);
  return next;
}

export async function deleteCutoff(id: number): Promise<void> {
  await requireWriter();
  const file: CutoffFile = await readSharedFile(FILE, CutoffFileSchema);
  if (!file.cutoffs.some((c) => c.id === id)) throw new NotFoundError('Cut-off service not found');
  await writeSharedFile(FILE, { ...file, cutoffs: file.cutoffs.filter((c) => c.id !== id) }, CutoffFileSchema);
}
