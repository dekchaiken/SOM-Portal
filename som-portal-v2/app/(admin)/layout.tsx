// som-portal-v2/app/(admin)/layout.tsx
import * as React from "react";
import { AdminNav } from "./_components/AdminNav";

/**
 * Admin layout — narrow sidebar + main area. Admin pages run their own
 * role gate; the sidebar only renders admin-group entries so already-visible
 * items are presumed authorised.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-dvh grid lg:grid"
      style={{
        gridTemplateColumns: "15rem minmax(0, 1fr)",
      }}
    >
      <div className="sticky top-0 h-dvh">
        <AdminNav />
      </div>
      <main className="min-w-0 p-6">{children}</main>
    </div>
  );
}
