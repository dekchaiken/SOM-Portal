// GET/POST: email templates (admin only)
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from '@/mail/templates';
import { errorJson, jsonBody, okJson } from '@/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireRole(...ADMIN_ROLES);
    const templates = await listTemplates();
    return okJson(templates);
  } catch (e) {
    return errorJson(e);
  }
}

const CreateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  html: z.string().min(1),
  variables: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole(...ADMIN_ROLES);
    const body = await jsonBody(req);
    const parsed = CreateSchema.parse(body);
    const result = await createTemplate(parsed);
    return okJson(result, 201);
  } catch (e) {
    return errorJson(e);
  }
}

const UpdateSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  subject: z.string().optional(),
  html: z.string().optional(),
  variables: z.array(z.string()).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    await requireRole(...ADMIN_ROLES);
    const body = await jsonBody(req);
    const { id, ...rest } = UpdateSchema.parse(body);
    const result = await updateTemplate(id, rest);
    if (!result) return errorJson(new Error('Template not found'));
    return okJson(result);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireRole(...ADMIN_ROLES);
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return errorJson(new Error('id required'));
    const ok = await deleteTemplate(id);
    if (!ok) return errorJson(new Error('Template not found'));
    return okJson({ deleted: true });
  } catch (e) {
    return errorJson(e);
  }
}
