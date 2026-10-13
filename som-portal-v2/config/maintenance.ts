// som-portal-v2/config/maintenance.ts

import { canBypassMaintenance } from "./permissions";
import type { Role } from "./nav";

/**
 * Maintenance gate helper. Pages wrap their server component with
 * `isUnderMaintenance(pageId, role, flags)`; if true, render a themed
 * maintenance page instead of the real one.
 *
 * `flags` comes from `data/<team>/maintenance.json`
 * (owned by Agent A's data layer). Shape: `{ pageId: boolean }`.
 */
export function isUnderMaintenance(
  pageId: string,
  role: Role,
  flags: Readonly<Record<string, boolean>> | null | undefined,
): boolean {
  if (!flags) return false;
  if (canBypassMaintenance(role)) return false;
  return flags[pageId] === true;
}
