"use client";

import * as React from "react";
import { Icon } from "@/icons";

interface ScheduledJob {
  id: string;
  type: string;
  time: string;
  day_mode: string;
  days: string[];
  dates: number[];
  exclude_dates: number[];
  message: string;
  action_label: string;
  action_url: string;
  google_chat_webhooks: string[];
  enabled: boolean;
  last_run?: string;
  last_run_status?: string;
  created_at: string;
  created_by: string;
  updated_at?: string;
}

type FormData = {
  type: string;
  time: string;
  day_mode: string;
  days: string[];
  dates: number[];
  message: string;
  action_label: string;
  action_url: string;
  google_chat_webhooks: string;
  enabled: boolean;
};

const EMPTY_FORM: FormData = {
  type: "general",
  time: "09:00",
  day_mode: "weekly",
  days: ["mon", "tue", "wed", "thu", "fri"],
  dates: [],
  message: "",
  action_label: "",
  action_url: "",
  google_chat_webhooks: "",
  enabled: true,
};

const DAY_LABELS: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const TYPE_LABELS: Record<string, string> = {
  general: "General (Chat)",
  shift_summary: "Shift Summary",
  grafana_paused: "Grafana Paused Check",
};

export function ScheduledNotiClient() {
  const [jobs, setJobs] = React.useState<ScheduledJob[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const fetchJobs = React.useCallback(async () => {
    try {
      const res = await fetch("/v2/api/scheduled-noti");
      const json = await res.json();
      if (json.ok) setJobs(json.data ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchJobs(); }, [fetchJobs]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(job: ScheduledJob) {
    setForm({
      type: job.type,
      time: job.time,
      day_mode: job.day_mode,
      days: [...job.days],
      dates: [...job.dates],
      message: job.message,
      action_label: job.action_label,
      action_url: job.action_url,
      google_chat_webhooks: job.google_chat_webhooks.join("\n"),
      enabled: job.enabled,
    });
    setEditingId(job.id);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const body = {
      ...form,
      google_chat_webhooks: form.google_chat_webhooks
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      const url = editingId
        ? `/v2/api/scheduled-noti/${editingId}`
        : "/v2/api/scheduled-noti";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setMessage({ type: "ok", text: editingId ? "Job updated" : "Job created" });
        setShowForm(false);
        fetchJobs();
      } else {
        setMessage({ type: "err", text: json.error ?? "Save failed" });
      }
    } catch {
      setMessage({ type: "err", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(job: ScheduledJob) {
    try {
      const res = await fetch(`/v2/api/scheduled-noti/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      const json = await res.json();
      if (json.ok) fetchJobs();
      else setMessage({ type: "err", text: json.error ?? "Toggle failed" });
    } catch {
      setMessage({ type: "err", text: "Network error" });
    }
  }

  async function handleRun(id: string) {
    setRunningId(id);
    try {
      const res = await fetch(`/v2/api/scheduled-noti/${id}/run`, { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        setMessage({ type: "ok", text: json.data?.message ?? "Job executed" });
        fetchJobs();
      } else {
        setMessage({ type: "err", text: json.error ?? "Run failed" });
      }
    } catch {
      setMessage({ type: "err", text: "Network error" });
    } finally {
      setRunningId(null);
    }
  }

  async function handleDelete(id: string) {
    if (deletingId === id) {
      try {
        const res = await fetch(`/v2/api/scheduled-noti/${id}`, { method: "DELETE" });
        const json = await res.json();
        if (json.ok) {
          setMessage({ type: "ok", text: "Job deleted" });
          fetchJobs();
        } else {
          setMessage({ type: "err", text: json.error ?? "Delete failed" });
        }
      } catch {
        setMessage({ type: "err", text: "Network error" });
      }
      setDeletingId(null);
    } else {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
    }
  }

  function toggleDay(day: string) {
    setForm((prev) => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day],
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Icon name="loader" size={16} className="animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Scheduled Notifications</h1>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Icon name="plus" size={14} />
          New Job
        </button>
      </div>

      {message && (
        <div
          className={`rounded-[var(--radius)] border px-4 py-3 text-sm ${
            message.type === "ok"
              ? "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
              : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="rounded-[var(--radius-lg)] border border-[var(--accent)]/30 bg-[var(--bg-card)] p-6"
        >
          <h2 className="mb-4 text-base font-semibold">
            {editingId ? "Edit Job" : "Create Job"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Type</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Time (HH:MM)</span>
              <input
                type="time"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Schedule Mode</span>
              <select
                value={form.day_mode}
                onChange={(e) => setForm({ ...form, day_mode: e.target.value })}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {form.day_mode === "weekly" && (
              <div>
                <span className="mb-1 block text-sm font-medium">Days</span>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(DAY_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleDay(key)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        form.days.includes(key)
                          ? "bg-[var(--accent)] text-white"
                          : "border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-raised)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {form.day_mode === "monthly" && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Dates (comma-separated)</span>
                <input
                  type="text"
                  value={form.dates.join(",")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dates: e.target.value.split(",").map(Number).filter((n) => n > 0 && n <= 31),
                    })
                  }
                  placeholder="1,15"
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
                />
              </label>
            )}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Message</span>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={3}
                placeholder="Notification message..."
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Action Label</span>
              <input
                type="text"
                value={form.action_label}
                onChange={(e) => setForm({ ...form, action_label: e.target.value })}
                placeholder="Open Dashboard"
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Action URL</span>
              <input
                type="text"
                value={form.action_url}
                onChange={(e) => setForm({ ...form, action_url: e.target.value })}
                placeholder="https://..."
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">
                Google Chat Webhook URLs (one per line)
              </span>
              <textarea
                value={form.google_chat_webhooks}
                onChange={(e) => setForm({ ...form, google_chat_webhooks: e.target.value })}
                rows={2}
                placeholder="https://chat.googleapis.com/v1/spaces/..."
                className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="rounded border-[var(--border)]"
              />
              <span className="text-sm">Enabled</span>
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-raised)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Jobs Table */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)]">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-[var(--text-muted)]">
            <Icon name="bell" size={24} />
            <p className="text-sm">No scheduled notifications yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Last Run</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggle(job)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          job.enabled
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            job.enabled ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        {job.enabled ? "Active" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs">
                        {TYPE_LABELS[job.type] ?? job.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">{job.time}</div>
                      <div className="text-[var(--text-muted)]">
                        {job.day_mode === "weekly"
                          ? job.days.map((d) => DAY_LABELS[d] ?? d).join(", ")
                          : `Day ${job.dates.join(", ")}`}
                      </div>
                    </td>
                    <td className="max-w-48 truncate px-4 py-3 text-xs">
                      {job.message || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {job.last_run
                        ? new Date(job.last_run).toLocaleString()
                        : "Never"}
                      {job.last_run_status && (
                        <span
                          className={`ml-1 ${
                            job.last_run_status === "ok"
                              ? "text-green-600"
                              : "text-red-500"
                          }`}
                        >
                          ({job.last_run_status})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleRun(job.id)}
                          disabled={runningId === job.id}
                          title="Run now"
                          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)] disabled:opacity-50"
                        >
                          {runningId === job.id ? (
                            <Icon name="loader" size={14} className="animate-spin" />
                          ) : (
                            <Icon name="play" size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(job)}
                          title="Edit"
                          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(job.id)}
                          title={deletingId === job.id ? "Click again to confirm" : "Delete"}
                          className={`rounded p-1.5 ${
                            deletingId === job.id
                              ? "bg-red-100 text-red-600 dark:bg-red-900/30"
                              : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-red-500"
                          }`}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
