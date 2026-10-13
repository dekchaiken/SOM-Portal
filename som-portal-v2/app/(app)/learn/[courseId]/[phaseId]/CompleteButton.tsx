"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent } from "@/ui/shadcn/card";

export function CompleteButton({ phaseId, alreadyPassed }: { phaseId: string; alreadyPassed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/v1/learn/phases/${phaseId}/complete`, { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "Could not complete the phase");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the phase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 pt-5">
        <p className="text-sm text-[var(--text-muted)]">
          {alreadyPassed ? "This phase is complete." : "This phase has no quiz. Mark it complete after reading."}
        </p>
        {!alreadyPassed ? (
          <Button onClick={complete} disabled={busy} className="glass-btn">
            {busy ? "Saving…" : "Mark phase complete"}
          </Button>
        ) : null}
        {error ? <p role="alert" className="w-full text-sm text-[var(--state-danger)]">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
