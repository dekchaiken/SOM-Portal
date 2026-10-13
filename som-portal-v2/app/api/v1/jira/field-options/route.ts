// som-portal-v2/app/api/v1/jira/field-options/route.ts
// Port of v1 api/jira/field-options.php — createmeta allowedValues, falling
// back to the field-context option API. Soft-fails to {} when Jira is down so
// the Create-Issue form still renders free-text inputs.
import { jsonError, jsonOk } from "@/jira/http";
import { requireJiraRead } from "@/jira/access";
import { listFieldOptions } from "@/jira/client";
import { loadJiraConfig } from "@/jira/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireJiraRead();
    const cfg = await loadJiraConfig();
    try {
      return jsonOk(await listFieldOptions(cfg.custom_fields));
    } catch {
      return jsonOk({});
    }
  } catch (e) {
    return jsonError(e);
  }
}
