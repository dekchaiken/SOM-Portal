// som-portal-v2/app/(app)/not-found.tsx
import Link from "next/link";
import { Button } from "@/ui/shadcn/button";
import { Icon } from "@/icons";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: "var(--bg-raised)", color: "var(--text-muted)" }}
      >
        <Icon name="search" size={22} />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          The page you were looking for isn't here.
        </p>
      </div>
      <Link href="/dashboard">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
