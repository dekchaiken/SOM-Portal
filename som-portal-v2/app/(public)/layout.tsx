// som-portal-v2/app/(public)/layout.tsx
import * as React from "react";

/**
 * Public shell is intentionally bare — individual pages (login,
 * forgot-password, reset-password) own their full-bleed layout and
 * flair so each can tailor the composition.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
