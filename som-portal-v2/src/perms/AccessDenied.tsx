// som-portal-v2/src/perms/AccessDenied.tsx
import * as React from "react";
import Link from "next/link";
import { Icon } from "@/icons";
import type { DenyReason } from "@/config/permissions";

const COPY: Record<DenyReason, string> = {
  no_session: "Your session has expired. Sign in again.",
  admin_only: "This page is restricted to administrators.",
  role: "Your role does not include this page.",
  deny_role: "Your role is explicitly excluded from this page.",
  super_viewer_denied: "Oversight accounts cannot open this page.",
  genz_only: "This page is a GenZ Team perk.",
  external_section: "External accounts cannot open admin or dev pages.",
  team: "This page belongs to another team.",
  feature: "Your team has not been granted this feature.",
  feature_page: "Your team's grant for this feature excludes this page.",
  menu_permissions: "An administrator has turned this page off for your role.",
  maintenance: "This page is under maintenance.",
};

/**
 * Rendered by a page whose server-side gate denied the request. The gate itself
 * already ran — this is only the explanation.
 */
export function AccessDenied({ reason, page }: { reason?: DenyReason; page?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div
        className="flex max-w-md flex-col items-start gap-3 rounded-[var(--radius-card,10px)] border p-6"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: "var(--bg-raised)" }}
        >
          <Icon name="shield" size={18} className="text-[var(--accent)]" />
        </span>
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {reason ? COPY[reason] : "You do not have access to this page."}
        </p>
        {page ? (
          <code className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]" style={{ background: "var(--bg-raised)" }}>
            {page}
          </code>
        ) : null}
        <Link
          href="/dashboard"
          className="mt-1 inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline"
        >
          <Icon name="arrow-right" size={14} />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
