"use client";

// som-portal-v2/app/(app)/learn/exams/[examId]/StartButton.tsx
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/icons";

export function StartButton({ examId, inProgressId, blocked }: { examId: string; inProgressId: string | null; blocked: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (inProgressId) {
    return (
      <Link
        href={`/learn/exams/${examId}/attempt/${inProgressId}`}
        className="glass-btn glass-btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] text-sm font-semibold text-white"
      >
        <Icon name="play" size={15} />
        Resume attempt
      </Link>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/v1/learn/exams/${examId}/attempts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error ?? `Could not start (${res.status})`);
      router.push(`/learn/exams/${examId}/attempt/${json.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the exam");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy || blocked !== null}
        className="glass-btn glass-btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon name={busy ? "loader" : "play"} size={15} />
        {busy ? "Starting…" : "Start exam"}
      </button>
      {blocked ? <p className="text-xs text-[var(--state-warning)]">{blocked}</p> : null}
      {error ? <p className="text-xs text-[var(--state-danger)]">{error}</p> : null}
    </div>
  );
}
