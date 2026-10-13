// som-portal-v2/src/ui/auth/AuthCard.tsx
// Liquid Glass shell shared by login, forgot-password and reset-password.
import * as React from "react";

export function AuthBackdrop() {
  return (
    <>
      <div aria-hidden className="login-blob login-blob-a" />
      <div aria-hidden className="login-blob login-blob-b" />
      <div aria-hidden className="login-blob login-blob-c" />
    </>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-card glass-card-in relative z-10 mx-auto flex w-full max-w-md flex-col gap-6">
      <div aria-hidden className="glass-bg" />
      <div className="relative z-10 flex flex-col gap-6">{children}</div>
    </div>
  );
}
