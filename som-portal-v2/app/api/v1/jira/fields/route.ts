// som-portal-v2/app/api/v1/jira/fields/route.ts
// Port of v1 api/jira/fields.php. Cached 10 min in src/jira/client.ts.
import { jsonError, jsonOk } from "@/jira/http";
import { requireJiraRead } from "@/jira/access";
import { listCustomFields } from "@/jira/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireJiraRead();
    return jsonOk(await listCustomFields());
  } catch (e) {
    return jsonError(e);
  }
}
