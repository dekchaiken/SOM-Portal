"use client";

// Superadmin console for login access: Keycloak SSO settings, per-user sign-in methods,
// new SSO users by email, and the bulk move of legacy accounts to SSO.
import * as React from "react";
import { Icon } from "@/icons";
import type { PublicAuthConfig } from "@/auth/auth-config";
import type { AccessUserView } from "@/auth/user-admin";

type Method = "password" | "sso";

const FIELD = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-strong)] outline-none focus:border-[var(--accent)]";
const BTN = "rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--bg-hover,var(--bg-card))] disabled:opacity-50";
const BTN_PRIMARY = "rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

interface Props {
  initialConfig: PublicAuthConfig;
  initialUsers: AccessUserView[];
}

async function api<T>(method: string, url: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: `Request failed (${res.status})` }));
  return json as { ok: boolean; data?: T; error?: string };
}

export function AuthAccessClient({ initialConfig, initialUsers }: Props) {
  const [config, setConfig] = React.useState(initialConfig);
  const [users, setUsers] = React.useState(initialUsers);
  const [query, setQuery] = React.useState("");
  const [notice, setNotice] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [setupLinks, setSetupLinks] = React.useState<Record<string, string>>({});
  const [creating, setCreating] = React.useState(false);

  // SSO form state. The secret is write-only: empty means keep the stored value.
  const [form, setForm] = React.useState({
    sso_enabled: initialConfig.sso_enabled,
    sso_label: initialConfig.sso_label,
    issuer: initialConfig.issuer,
    client_id: initialConfig.client_id,
    client_secret: "",
  });
  const [saving, setSaving] = React.useState(false);

  const flash = (kind: "ok" | "err", text: string) => setNotice({ kind, text });

  async function saveConfig() {
    setSaving(true);
    const res = await api<PublicAuthConfig>("PUT", "/v2/api/v1/auth/config", form);
    setSaving(false);
    if (!res.ok || !res.data) return flash("err", res.error ?? "Could not save SSO settings.");
    setConfig(res.data);
    setForm((f) => ({ ...f, client_secret: "", sso_enabled: res.data!.sso_enabled }));
    flash("ok", "SSO settings saved.");
  }

  async function setMethods(user: AccessUserView, next: Method[]) {
    if (next.length === 0) return flash("err", "Keep at least one sign-in method.");
    const res = await api<{ user: AccessUserView; setup_url: string | null }>(
      "PATCH",
      `/v2/api/v1/auth/users/${encodeURIComponent(user.id)}`,
      { allowed_methods: next },
    );
    if (!res.ok || !res.data) return flash("err", res.error ?? "Could not update sign-in methods.");
    setUsers((list) => list.map((u) => (u.id === user.id ? res.data!.user : u)));
    if (res.data.setup_url) setSetupLinks((m) => ({ ...m, [user.id]: res.data!.setup_url! }));
    flash("ok", `Updated ${user.username}.`);
  }

  async function closeLegacy() {
    if (!window.confirm("Move every legacy account to its team default? Wealth BU, Jenkins Portal and SO Jenkins keep password. Everyone else becomes SSO only.")) return;
    const res = await api<{ closed: number; kept_password: number }>("POST", "/v2/api/v1/auth/legacy-close");
    if (!res.ok || !res.data) return flash("err", res.error ?? "Could not update legacy accounts.");
    const fresh = await api<{ users: AccessUserView[] }>("GET", "/v2/api/v1/auth/users");
    if (fresh.ok && fresh.data) setUsers(fresh.data.users);
    flash("ok", `Closed password for ${res.data.closed} account(s). Kept password for ${res.data.kept_password}.`);
  }

  const shown = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [u.username, u.name, u.email, u.team, u.role].some((v) => v.toLowerCase().includes(q));
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">Login access</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Keycloak SSO is the default sign-in. Passwords are granted per user.
        </p>
      </header>

      {notice ? (
        <div role="status" className={`glass-card px-4 py-3 text-sm ${notice.kind === "err" ? "text-[var(--danger)]" : "text-[var(--text-strong)]"}`}>
          {notice.text}
        </div>
      ) : null}

      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-strong)]">Keycloak SSO</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {config.sso_ready ? "Ready. The login page shows the Keycloak button." : "Not ready. Fill every field and set MAIL_CREDS_KEY on the server."}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.sso_enabled}
              onChange={(e) => setForm({ ...form, sso_enabled: e.target.checked })}
            />
            Show Keycloak sign-in
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Button label">
            <input className={FIELD} value={form.sso_label} onChange={(e) => setForm({ ...form, sso_label: e.target.value })} />
          </Field>
          <Field label="Issuer URL">
            <input className={FIELD} placeholder="https://keycloak.example/realms/som" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
          </Field>
          <Field label="Client ID">
            <input className={FIELD} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
          </Field>
          <Field label={config.client_secret_set ? "Client secret (saved, leave blank to keep)" : "Client secret"}>
            <input
              type="password"
              autoComplete="new-password"
              className={FIELD}
              value={form.client_secret}
              onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
            />
          </Field>
        </div>

        {!config.key_configured ? (
          <p className="text-xs text-[var(--danger)]">MAIL_CREDS_KEY is not set on the server. The secret cannot be saved until it is.</p>
        ) : null}

        <div className="flex justify-end">
          <button type="button" className={BTN_PRIMARY} onClick={saveConfig} disabled={saving}>
            {saving ? "Saving…" : "Save SSO settings"}
          </button>
        </div>
      </section>

      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-strong)]">Users</h2>
            <p className="text-xs text-[var(--text-muted)]">{users.length} accounts. Toggle methods per user.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN} onClick={closeLegacy}>
              Close password for legacy accounts
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
              Add SSO user
            </button>
          </div>
        </div>

        <input className={FIELD} placeholder="Search name, username, email, team, role" value={query} onChange={(e) => setQuery(e.target.value)} />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--text-muted)]">
              <tr>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Team</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Sign-in methods</th>
                <th className="py-2">Setup link</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-[var(--text-strong)]">{u.name || u.username}</div>
                    <div className="text-xs text-[var(--text-muted)]">{u.email || "no email"} · {u.username}</div>
                    {u.legacy ? <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] uppercase text-[var(--text-muted)]">legacy</span> : null}
                  </td>
                  <td className="py-2 pr-3">{u.team}</td>
                  <td className="py-2 pr-3">{u.role}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2">
                      <MethodChip active={u.allowed_methods.includes("sso")} label="SSO" onClick={() => setMethods(u, toggle(u.allowed_methods, "sso"))} />
                      <MethodChip active={u.allowed_methods.includes("password")} label="Password" onClick={() => setMethods(u, toggle(u.allowed_methods, "password"))} />
                    </div>
                  </td>
                  <td className="py-2">
                    {setupLinks[u.id] ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                        onClick={() => navigator.clipboard?.writeText(setupLinks[u.id]!)}
                      >
                        <Icon name="link" size={12} /> Copy link
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">{u.has_password ? "has password" : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-[var(--text-muted)]">No matching users.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {creating ? (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(user) => {
            setUsers((list) => [...list, user].sort((a, b) => a.team.localeCompare(b.team) || a.username.localeCompare(b.username)));
            setCreating(false);
            flash("ok", `Added ${user.email}. They sign in with Keycloak.`);
          }}
          onError={(text) => flash("err", text)}
        />
      ) : null}
    </div>
  );
}

function toggle(current: Method[], method: Method): Method[] {
  return current.includes(method) ? current.filter((m) => m !== method) : [...current, method];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
      {label}
      {children}
    </label>
  );
}

function MethodChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
        active ? "border-transparent bg-[var(--accent)] text-white" : "border-[var(--border)] text-[var(--text-muted)]"
      }`}
    >
      {label}
    </button>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (user: AccessUserView) => void;
  onError: (text: string) => void;
}) {
  const [draft, setDraft] = React.useState({ email: "", name: "", team: "sm", role: "sm_user", username: "" });
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api<{ user: AccessUserView }>("POST", "/v2/api/v1/auth/users", {
      ...draft,
      username: draft.username.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok || !res.data) return onError(res.error ?? "Could not create user.");
    onCreated(res.data.user);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="glass-card flex w-full max-w-md flex-col gap-3 p-5">
        <h2 className="text-base font-semibold text-[var(--text-strong)]">Add SSO user</h2>
        <p className="text-xs text-[var(--text-muted)]">The user signs in with Keycloak. No password is created.</p>
        <Field label="Email (must match the Keycloak account)">
          <input type="email" required className={FIELD} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </Field>
        <Field label="Name">
          <input required className={FIELD} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Team slug">
            <input required className={FIELD} value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })} />
          </Field>
          <Field label="Role">
            <select className={FIELD} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              {["sm_user", "sm_lead", "dev_user", "dev_sm", "sm_admin", "super_viewer", "external", "super_admin"].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Username (optional)">
          <input className={FIELD} value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN_PRIMARY} disabled={busy}>
            {busy ? "Adding…" : "Add user"}
          </button>
        </div>
      </form>
    </div>
  );
}
