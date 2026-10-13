// som-portal-v2/app/api/v1/jira/config/route.ts
// Port of v1 api/jira-config/index.php GET. Hot-reloads data/sm/jira_config.json
// on every request so an admin edit takes effect without a restart.
import { jsonError, jsonOk } from "@/jira/http";
import { requireJiraRead } from "@/jira/access";
import { loadJiraConfig } from "@/jira/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireJiraRead();
    return jsonOk(await loadJiraConfig());
  } catch (e) {
    return jsonError(e);
  }
}
