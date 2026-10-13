// som-portal-v2/app/api/v1/templates/route.ts
// Port of v1 api/templates/index.php. `?id=` selects the row for PUT/DELETE,
// same as v1.
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/jira/http";
import {
  requireJiraRead,
  requireJiraManage,
  requireJiraDelete,
} from "@/jira/access";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  loadJiraConfig,
  updateTemplate,
} from "@/jira/templates";
import { lintTemplateFields } from "@/jira/fields";
import { TemplateCreateSchema, TemplateUpdateSchema } from "@/jira/schemas";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const access = await requireJiraRead();
    const [templates, cfg] = await Promise.all([listTemplates(), loadJiraConfig()]);
    // Soft-fail drift surfacing (R-01 §5): warn, never block.
    const warnings = templates.flatMap((t) =>
      lintTemplateFields(cfg, t.fields).map((w) => `${t.id}: ${w}`),
    );
    return jsonOk({
      templates,
      warnings,
      can_manage: access.canManage,
      can_delete: access.canDelete,
      can_create_issue: access.canCreateIssue,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const access = await requireJiraManage();
    const parsed = TemplateCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid payload");
    }
    const tpl = await createTemplate(parsed.data, access.session);
    return jsonOk(tpl, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  try {
    const access = await requireJiraManage();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!id) throw new ValidationError("Template ID required");
    const parsed = TemplateUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid payload");
    const tpl = await updateTemplate(id, parsed.data, access.session);
    return jsonOk(tpl);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    const access = await requireJiraDelete();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    await deleteTemplate(id, access.session);
    return jsonOk({ id });
  } catch (e) {
    return jsonError(e);
  }
}
