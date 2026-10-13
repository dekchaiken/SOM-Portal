// som-portal-v2/app/(app)/jira-templates/page.tsx
//
// Server component. Reads the REAL v1 SM-shared files (data/sm/templates.json,
// data/sm/jira_config.json) and gates on the same multi-team rules as v1:
// team feature flag (teams.json) + per-team menu-permissions.json + nav roles.
import { PulseHeader } from "@/ui/PulseHeader";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Icon } from "@/icons";
import { getJiraAccess } from "@/jira/access";
import { requireAuth } from "@/auth/policy";
import { listTemplates, loadJiraConfig } from "@/jira/templates";
import { lintTemplateFields, visibleFields } from "@/jira/fields";
import { listFieldOptions } from "@/jira/client";
import { TemplateBrowser } from "./_components/TemplateBrowser";

export const metadata = { title: "Jira Templates · SOM Portal" };
export const dynamic = "force-dynamic";

const JIRA_BOARD_URL =
  "https://truemoney.atlassian.net/jira/software/c/projects/SMC/boards/1591";

function AccessDenied({ team }: { team: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Icon name="shield" size={28} className="text-[var(--text-subtle)]" />
        <p className="text-sm font-medium">
          Your team ({team}) does not have access to Jira Templates.
        </p>
        <p className="max-w-md text-xs text-[var(--text-muted)]">
          Access is granted per team by a super admin via team features
          (<code>jira-templates</code> / <code>jira-templates-shared</code>).
        </p>
      </CardContent>
    </Card>
  );
}

export default async function JiraTemplatesPage() {
  const session = await requireAuth();
  const access = await getJiraAccess(session);

  if (!access.canRead) {
    return (
      <div className="flex flex-col gap-5">
        <PulseHeader title="Jira Templates" subtitle="Templates & incident tickets" />
        <AccessDenied team={session.team} />
      </div>
    );
  }

  const [templates, cfg] = await Promise.all([listTemplates(), loadJiraConfig()]);

  // Option lists come from Jira; a cold/unreachable Jira must not break the
  // page, so soft-fail to {} and the form falls back to free-text inputs.
  let options: Record<string, { label: string; type: string; options: string[] }> = {};
  try {
    options = await listFieldOptions(cfg.custom_fields);
  } catch {
    options = {};
  }

  const warnings = templates.flatMap((t) =>
    lintTemplateFields(cfg, t.fields).map((w) => `${t.name || t.id} — ${w}`),
  );

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title="Jira Templates"
        subtitle={`${templates.length} templates · project SMC · library shared by the SM team`}
        live
        actions={
          <a
            href={JIRA_BOARD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-medium hover:border-[var(--accent)]"
            style={{ borderColor: "var(--border)" }}
          >
            View Jira Board <Icon name="external-link" size={13} />
          </a>
        }
      />

      <TemplateBrowser
        templates={templates}
        categories={cfg.categories}
        issueTypes={cfg.issue_types}
        fieldDefs={visibleFields(cfg)}
        fieldOptions={options}
        canManage={access.canManage}
        canCreateIssue={access.canCreateIssue}
        warnings={warnings}
        team={session.team}
      />
    </div>
  );
}
