// som-portal-v2/app/api/v1/jira/issue-types/route.ts
// Port of v1 api/jira/issue-types.php.
import { jsonError, jsonOk } from "@/jira/http";
import { requireJiraRead } from "@/jira/access";
import { listIssueTypes } from "@/jira/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireJiraRead();
    return jsonOk(await listIssueTypes());
  } catch (e) {
    return jsonError(e);
  }
}
