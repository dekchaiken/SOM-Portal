// som-portal-v2/app/api/v1/jira/create-issue/route.ts
// Port of v1 api/jira/create.php. Rate limited 20/min/user per the A2 brief.
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/jira/http";
import { requireJiraCreateIssue } from "@/jira/access";
import { getTemplate, loadJiraConfig, markTemplateUsed } from "@/jira/templates";
import { buildIssueFields, lintTemplateFields } from "@/jira/fields";
import { createIssue } from "@/jira/client";
import { CreateIssueSchema } from "@/jira/schemas";
import { getRateLimitBackend } from "@/lib/rate-limit";
import { logActivity } from "@/logging/activity";
import { logSecurity } from "@/logging/security";
import { NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import { err } from "@/lib/result";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 20;
const WINDOW_SEC = 60;

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const access = await requireJiraCreateIssue();
    const session = access.session;

    const rl = await getRateLimitBackend().check(
      `api:${session.sub}:jira-create-issue`,
      LIMIT,
      WINDOW_SEC,
    );
    if (!rl.ok) {
      await logSecurity({
        user: session.sub,
        team: session.team,
        event: "jira.create_issue.rate_limited",
        meta: { retryAfterMs: rl.retryAfterMs },
      });
      throw new RateLimitError(rl.retryAfterMs, "Too many ticket creations. Slow down.");
    }

    const parsed = CreateIssueSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Summary is required");
    }
    const body = parsed.data;

    // Resolve template (brief form) and merge overrides over its stored fields.
    let summary = body.summary?.trim() ?? "";
    let fields: Record<string, unknown> = { ...(body.fields ?? {}) };
    if (body.templateId) {
      const tpl = await getTemplate(body.templateId);
      if (!tpl) throw new NotFoundError("Template not found");
      if (!summary) summary = tpl.summary;
      fields = { ...tpl.fields, ...fields, ...(body.overrides ?? {}) };
    } else if (body.overrides) {
      fields = { ...fields, ...body.overrides };
    }
    if (!summary) throw new ValidationError("Summary is required");

    const cfg = await loadJiraConfig();
    const warnings = lintTemplateFields(cfg, fields);
    const jiraFields = buildIssueFields({
      cfg,
      summary,
      description: body.description ?? "",
      fields,
    });

    const outcome = await createIssue(jiraFields);
    if (!outcome.ok) {
      // v1 responds 422 with the raw Jira envelope for debugging.
      return NextResponse.json(
        {
          ...err(outcome.message, "jira_rejected"),
          jira_errors: outcome.jira_errors,
          jira_messages: outcome.jira_messages,
          jira_payload: { fields: jiraFields },
        },
        { status: 422 },
      );
    }

    await logActivity({
      user: session.sub,
      team: session.team,
      action: "jira_create_ticket",
      meta: { issue_key: outcome.issue.issue_key, summary, template_id: body.templateId ?? null },
    });
    if (body.templateId) await markTemplateUsed(body.templateId);

    return jsonOk({ ...outcome.issue, warnings });
  } catch (e) {
    return jsonError(e);
  }
}
