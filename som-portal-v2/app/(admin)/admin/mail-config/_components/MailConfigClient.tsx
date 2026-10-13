"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { parseRecipients } from "@/mail/recipients";

interface MailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: string;
  smtp_user: string;
  smtp_password: string;
  smtp_password_set: boolean;
  from_name: string;
  from_email: string;
  global_cc: string[];
  email_signature: string;
  brand_enabled: boolean;
  brand_color: string;
  header_text: string;
  footer_text: string;
}

interface TestStep {
  label: string;
  ok: boolean;
  detail: string;
}

interface MailLog {
  id: string;
  sent_at: string;
  to: string[];
  subject: string;
  status: string;
  error: string;
  sent_by_name: string;
}

export function MailConfigClient() {
  const [config, setConfig] = React.useState<MailConfig | null>(null);
  const [ccText, setCcText] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [testSteps, setTestSteps] = React.useState<TestStep[]>([]);
  const [testing, setTesting] = React.useState(false);
  const [testEmail, setTestEmail] = React.useState("");
  const [sendingTest, setSendingTest] = React.useState(false);
  const [logs, setLogs] = React.useState<MailLog[]>([]);
  const [logsTotal, setLogsTotal] = React.useState(0);

  const [teams, setTeams] = React.useState<{ slug: string; name: string }[]>([]);
  // "" means the admin's own team. Only super_admin gets the team list.
  const [teamSlug, setTeamSlug] = React.useState("");

  React.useEffect(() => {
    fetch("/v2/api/mail/teams")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setTeams(j.data); })
      .catch(() => {});
    fetchLogs();
  }, []);

  React.useEffect(() => {
    void fetchConfig(teamSlug);
  }, [teamSlug]);

  async function fetchConfig(slug: string) {
    try {
      const res = await fetch(`/v2/api/mail/config${slug ? `?team=${encodeURIComponent(slug)}` : ""}`);
      const json = await res.json();
      if (json.ok) setConfig(json.data);
    } catch { /* ignore */ }
  }

  async function fetchLogs() {
    try {
      const res = await fetch("/v2/api/mail/logs?limit=20");
      const json = await res.json();
      if (json.ok) {
        setLogs(json.data.logs ?? []);
        setLogsTotal(json.data.total ?? 0);
      }
    } catch { /* ignore */ }
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        smtp_host: config.smtp_host,
        smtp_port: config.smtp_port,
        smtp_encryption: config.smtp_encryption,
        smtp_user: config.smtp_user,
        from_name: config.from_name,
        from_email: config.from_email,
        global_cc: config.global_cc.filter(Boolean),
        email_signature: config.email_signature,
        brand_enabled: config.brand_enabled,
        brand_color: config.brand_color,
        header_text: config.header_text,
        footer_text: config.footer_text,
      };
      if (config.smtp_password) body.smtp_password = config.smtp_password;
      if (teamSlug) body.team = teamSlug;
      const res = await fetch("/v2/api/mail/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setConfig(json.data);
        setMessage({ type: "ok", text: "Configuration saved" });
      } else {
        setMessage({ type: "err", text: json.error ?? "Save failed" });
      }
    } catch {
      setMessage({ type: "err", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestSteps([]);
    try {
      const res = await fetch("/v2/api/mail/test-connection", { method: "POST" });
      const json = await res.json();
      if (json.ok) setTestSteps(json.data.steps ?? []);
    } catch {
      setTestSteps([{ label: "Connection", ok: false, detail: "Network error" }]);
    } finally {
      setTesting(false);
    }
  }

  async function handleSendTest() {
    if (!testEmail) return;
    setSendingTest(true);
    try {
      const res = await fetch("/v2/api/mail/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail }),
      });
      const json = await res.json();
      if (json.ok && json.data.ok) {
        setMessage({ type: "ok", text: `Test email sent to ${testEmail}` });
      } else {
        setMessage({ type: "err", text: json.data?.error ?? json.error ?? "Send failed" });
      }
      fetchLogs();
    } catch {
      setMessage({ type: "err", text: "Network error" });
    } finally {
      setSendingTest(false);
    }
  }

  function update(field: keyof MailConfig, value: unknown) {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  }

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Icon name="loader" size={16} className="animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Mail Configuration</h1>
      {teams.length > 0 ? (
        <label className="mt-3 flex max-w-sm flex-col gap-1 text-sm">
          <span className="font-medium">Team</span>
          <select
            value={teamSlug}
            onChange={(e) => setTeamSlug(e.target.value)}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
          >
            <option value="">My team</option>
            {teams.map((t) => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </select>
        </label>
      ) : null}

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

      {/* SMTP Settings */}
      <form onSubmit={handleSave} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h2 className="mb-4 text-base font-semibold">SMTP Settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">SMTP Host</span>
            <input
              type="text"
              value={config.smtp_host}
              onChange={(e) => update("smtp_host", e.target.value)}
              placeholder="smtp.example.com"
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Port</span>
            <input
              type="number"
              value={config.smtp_port}
              onChange={(e) => update("smtp_port", Number(e.target.value))}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Encryption</span>
            <select
              value={config.smtp_encryption}
              onChange={(e) => update("smtp_encryption", e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            >
              <option value="none">None</option>
              <option value="tls">TLS / STARTTLS</option>
              <option value="ssl">SSL</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Username</span>
            <input
              type="text"
              value={config.smtp_user}
              onChange={(e) => update("smtp_user", e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Password {config.smtp_password_set && <span className="text-xs text-[var(--text-muted)]">(set - enter new to change)</span>}
            </span>
            <input
              type="password"
              value={config.smtp_password}
              onChange={(e) => update("smtp_password", e.target.value)}
              placeholder={config.smtp_password_set ? "****" : ""}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">From Name</span>
            <input
              type="text"
              value={config.from_name}
              onChange={(e) => update("from_name", e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">From Email</span>
            <input
              type="email"
              value={config.from_email}
              onChange={(e) => update("from_email", e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Global CC</span>
            <input
              value={ccText ?? config.global_cc.join(", ")}
              onChange={(e) => {
                setCcText(e.target.value);
                setConfig({ ...config, global_cc: parseRecipients(e.target.value).valid });
              }}
              placeholder="Added to every mail, comma separated"
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
            {parseRecipients(ccText ?? "").invalid.length > 0 ? (
              <span className="mt-1 block text-xs text-[var(--state-danger)]">
                Not a valid address: {parseRecipients(ccText ?? "").invalid.join(", ")}
              </span>
            ) : null}
          </label>
          <div className="sm:col-span-2 mt-2 rounded-[var(--radius)] border border-[var(--border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Branding</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={config.brand_enabled} onChange={(e) => update("brand_enabled", e.target.checked)} className="accent-[var(--accent)]" />
                Add header and footer to sent mail
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Header text (under the app name)</span>
                <input value={config.header_text} onChange={(e) => update("header_text", e.target.value)} placeholder="e.g. Service Monitoring Center" className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Brand colour</span>
                <input type="color" value={config.brand_color} onChange={(e) => update("brand_color", e.target.value)} className="h-[38px] w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] p-1" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Footer (one line per row)</span>
                <textarea rows={3} value={config.footer_text} onChange={(e) => update("footer_text", e.target.value)} placeholder={"SMC: 091-696-9885 (24hrs)\nBy Ascend Money Service Monitoring Center / Technology"} className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm" />
              </label>
            </div>
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Email signature</span>
            <textarea
              rows={4}
              value={config.email_signature}
              onChange={(e) => update("email_signature", e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </form>

      {/* Test Connection */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h2 className="mb-4 text-base font-semibold">Test Connection</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing}
            className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--bg-raised)] disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="recipient@example.com"
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleSendTest}
              disabled={sendingTest || !testEmail}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {sendingTest ? "Sending..." : "Send Test Email"}
            </button>
          </div>
        </div>
        {testSteps.length > 0 && (
          <div className="mt-4 space-y-2">
            {testSteps.map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-sm ${
                  step.ok
                    ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20"
                    : "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20"
                }`}
              >
                <Icon name={step.ok ? "check-circle" : "alert-circle"} size={16} className={`mt-0.5 shrink-0 ${step.ok ? "text-green-600" : "text-red-600"}`} />
                <div>
                  <div className="font-medium">{step.label}</div>
                  <div className="text-xs opacity-80">{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mail Logs */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Mail Logs</h2>
          <span className="text-xs text-[var(--text-muted)]">{logsTotal} total</span>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No mail logs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">To</th>
                  <th className="pb-2 pr-4">Subject</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Sent By</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--border)]">
                    <td className="whitespace-nowrap py-2 pr-4 text-xs text-[var(--text-muted)]">
                      {new Date(log.sent_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-xs">{log.to.join(", ")}</td>
                    <td className="max-w-48 truncate py-2 pr-4">{log.subject}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                          log.status === "sent"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-[var(--text-muted)]">{log.sent_by_name}</td>
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
