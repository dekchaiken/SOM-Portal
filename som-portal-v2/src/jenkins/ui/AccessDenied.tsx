// som-portal-v2/src/jenkins/ui/AccessDenied.tsx
import * as React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Icon } from '@/icons';

/**
 * Rendered when a page's team-feature gate fails. Mirrors v1's behaviour:
 * the sidebar hides the entry AND the page itself refuses, so a guessed URL
 * does not leak another team's surface.
 */
export function AccessDenied({
  feature,
  team,
  reason,
}: {
  feature: string;
  team: string;
  reason?: string;
}) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert variant="warning">
        <AlertTitle className="flex items-center gap-2">
          <Icon name="shield" size={16} /> Not available for your team
        </AlertTitle>
        <AlertDescription>
          {reason ??
            `Your team (${team}) does not have the “${feature}” feature granted.`}{' '}
          A super admin can grant it in Admin → Super Team Permissions.
        </AlertDescription>
      </Alert>
    </div>
  );
}
