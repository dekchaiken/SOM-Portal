// som-portal-v2/src/mail/templates.ts
// Email template registry — CRUD for email_templates.json

import { z } from 'zod';
import { readTeamFile, writeTeamFile } from '@/team/scope';

const TEMPLATES_FILE = 'email_templates.json';

export const EmailTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  html: z.string(),
  variables: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

const TemplatesFileSchema = z.array(EmailTemplateSchema).default([]);

function genId(): string {
  return 'tpl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listTemplates(): Promise<EmailTemplate[]> {
  return readTeamFile(TEMPLATES_FILE, TemplatesFileSchema);
}

export async function getTemplate(id: string): Promise<EmailTemplate | null> {
  const all = await listTemplates();
  return all.find((t) => t.id === id) ?? null;
}

export async function createTemplate(
  input: Omit<EmailTemplate, 'id' | 'created_at' | 'updated_at'>,
): Promise<EmailTemplate> {
  const entry: EmailTemplate = {
    ...input,
    id: genId(),
    created_at: new Date().toISOString(),
  };
  const all = await listTemplates();
  all.push(entry);
  await writeTeamFile(TEMPLATES_FILE, all, TemplatesFileSchema);
  return entry;
}

export async function updateTemplate(
  id: string,
  input: Partial<Pick<EmailTemplate, 'name' | 'subject' | 'html' | 'variables'>>,
): Promise<EmailTemplate | null> {
  const all = await listTemplates();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  if (input.name !== undefined) all[idx].name = input.name;
  if (input.subject !== undefined) all[idx].subject = input.subject;
  if (input.html !== undefined) all[idx].html = input.html;
  if (input.variables !== undefined) all[idx].variables = input.variables;
  all[idx].updated_at = new Date().toISOString();
  await writeTeamFile(TEMPLATES_FILE, all, TemplatesFileSchema);
  return all[idx];
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const all = await listTemplates();
  const filtered = all.filter((t) => t.id !== id);
  if (filtered.length === all.length) return false;
  await writeTeamFile(TEMPLATES_FILE, filtered, TemplatesFileSchema);
  return true;
}

/**
 * Render a template with variable substitution.
 * Variables in the template are {{variable_name}}.
 */
export function renderTemplate(
  template: EmailTemplate,
  vars: Record<string, string>,
): { subject: string; html: string } {
  let subject = template.subject;
  let html = template.html;
  for (const [key, value] of Object.entries(vars)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    subject = subject.replace(pattern, value);
    html = html.replace(pattern, value);
  }
  return { subject, html };
}
