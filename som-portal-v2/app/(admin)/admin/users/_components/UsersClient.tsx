"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import type { SafeUser } from "@/admin/users-schema";
import type { TeamOption } from "@/admin/users-service";
import type { Result } from "@/lib/result";
import {
  Avatar,
  ConfirmDialog,
  ROLE_LABELS,
  RoleChip,
  Select,
  ToastStack,
  useToasts,
} from "./bits";
import { UserDrawer, type DrawerState, type SavePayload } from "./UserDrawer";

const API = "/v2/api/v1/users";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as Result<T> | null;
  if (!body) throw new Error(`Request failed (${res.status})`);
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

function relative(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function UsersClient({
  initialUsers,
  teams,
  initialTeam,
  assignableRoles,
  isSuperAdmin,
  sessionUserId,
  sessionTeam,
}: {
  initialUsers: SafeUser[];
  teams: TeamOption[];
  initialTeam: string | null;
  assignableRoles: string[];
  isSuperAdmin: boolean;
  sessionUserId: string;
  sessionTeam: string;
}) {
  const [users, setUsers] = React.useState(initialUsers);
  const [team, setTeam] = React.useState<string>(initialTeam ?? "");
  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("");
  const [drawer, setDrawer] = React.useState<DrawerState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [confirm, setConfirm] = React.useState<null | { kind: "delete" | "reset"; user: SafeUser }>(
    null,
  );
  const { toasts, push, dismiss } = useToasts();

  const reload = React.useCallback(
    async (nextTeam: string) => {
      setLoading(true);
      try {
        const qs = nextTeam ? `?team=${encodeURIComponent(nextTeam)}` : "";
        const data = await call<{ users: SafeUser[] }>(`${API}${qs}`);
        setUsers(data.users);
      } catch (e) {
        push("error", (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [push],
  );

  const roles = React.useMemo(
    () => [...new Set(users.map((u) => u.role))].sort(),
    [users],
  );

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => (roleFilter ? u.role === roleFilter : true))
      .filter((u) =>
        q
          ? [u.name, u.username, u.email, u.nickname, u.emp_id]
              .join(" ")
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, query, roleFilter]);

  async function save(form: SavePayload) {
    if (!drawer) return;
    setBusy(true);
    try {
      if (drawer.mode === "create") {
        const created = await call<{ user: SafeUser; temp_password: string }>(API, {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            username: form.username,
            email: form.email,
            role: form.role,
            team: form.team,
            nickname: form.nickname,
            name_th: form.name_th,
            emp_id: form.emp_id,
            phone: form.phone,
            dev_subteam: form.dev_subteam,
            schedule_include: form.schedule_include,
            course_include: form.course_include,
            exam_include: form.exam_include,
          }),
        });
        push(
          "success",
          `${created.user.username} created — copy the temporary password now, it is shown once`,
          created.temp_password,
        );
        setDrawer(null);
        await reload(team);
      } else if (drawer.user) {
        const patch: Record<string, unknown> = {
          name: form.name,
          nickname: form.nickname,
          email: form.email,
          name_th: form.name_th,
          emp_id: form.emp_id,
          phone: form.phone,
          schedule_include: form.schedule_include,
          course_include: form.course_include,
          exam_include: form.exam_include,
          must_reset_password: form.must_reset_password,
        };
        // Only send the role when it actually changed and we may grant it —
        // the API rejects an out-of-scope grant anyway, this keeps the audit
        // log honest.
        if (form.role !== drawer.user.role && assignableRoles.includes(form.role)) {
          patch.role = form.role;
        }
        if (form.role === "dev_user") patch.dev_subteam = form.dev_subteam ?? "";
        const updated = await call<SafeUser>(`${API}/${drawer.user.id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));
        push("success", `${updated.username} updated`);
        setDrawer(null);
      }
    } catch (e) {
      push("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "delete") {
        await call<{ id: string }>(`${API}/${confirm.user.id}`, { method: "DELETE" });
        setUsers((list) => list.filter((u) => u.id !== confirm.user.id));
        push("success", `${confirm.user.username} deleted`);
        setDrawer(null);
      } else {
        const res = await call<{ temp_password: string; masked_email: string }>(
          `${API}/${confirm.user.id}/reset-password`,
          { method: "POST" },
        );
        push(
          "success",
          `Temporary password for ${confirm.user.username} (${res.masked_email}) — shown once`,
          res.temp_password,
        );
        setUsers((list) =>
          list.map((u) =>
            u.id === confirm.user.id ? { ...u, must_reset_password: true } : u,
          ),
        );
      }
      setConfirm(null);
    } catch (e) {
      push("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = team
    ? (teams.find((t) => t.slug === team)?.name ?? team)
    : "All teams";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Administration
          </p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-[var(--text-strong)]">
            Users
            <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
              {scopeLabel} · {rows.length} of {users.length}
            </span>
          </h1>
        </div>
        <Button size="sm" onClick={() => setDrawer({ mode: "create", user: null })} data-testid="add-user">
          <Icon name="plus" size={14} /> Add user
        </Button>
      </header>

      <div
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border p-2.5"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <div className="relative min-w-[12rem] flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, username, email, emp ID"
            className="pl-8"
            data-testid="user-search"
          />
        </div>
        <Select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="w-auto"
          aria-label="Filter by role"
          data-testid="role-filter"
        >
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] ?? r}
            </option>
          ))}
        </Select>
        {teams.length > 1 ? (
          <Select
            value={team}
            onChange={(e) => {
              setTeam(e.target.value);
              void reload(e.target.value);
            }}
            className="w-auto"
            aria-label="Team scope"
            data-testid="team-scope"
          >
            {isSuperAdmin ? <option value="">All teams</option> : null}
            {teams.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
                {t.active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        ) : null}
        <Button variant="secondary" size="sm" onClick={() => void reload(team)} disabled={loading}>
          <Icon name="refresh" size={14} className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      <div
        className="overflow-hidden rounded-[var(--radius-lg)] border"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr
              className="text-left text-[11px] uppercase tracking-wider text-[var(--text-subtle)]"
              style={{ background: "var(--bg-raised)" }}
            >
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Email</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              {!team ? (
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Team</th>
              ) : null}
              <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Password changed</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  No users match this filter.
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr
                  key={u.id}
                  data-testid="user-row"
                  tabIndex={0}
                  onClick={() => setDrawer({ mode: "edit", user: u })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setDrawer({ mode: "edit", user: u });
                  }}
                  className="cursor-pointer border-t transition-colors hover:bg-[var(--bg-raised)] focus-visible:bg-[var(--bg-raised)] focus-visible:outline-none"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} username={u.username} src={u.avatar_url} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-[var(--text-strong)]">
                            {u.name || u.username}
                          </span>
                          {u.id === sessionUserId ? (
                            <span className="rounded bg-[var(--bg-raised)] px-1 text-[10px] text-[var(--text-muted)]">
                              you
                            </span>
                          ) : null}
                          {u.must_reset_password ? (
                            <Icon
                              name="alert-circle"
                              size={13}
                              aria-label="Must reset password"
                              style={{ color: "var(--state-warning)" }}
                            />
                          ) : null}
                        </div>
                        <span className="truncate text-xs text-[var(--text-subtle)]">
                          @{u.username}
                          {u.nickname ? ` · ${u.nickname}` : ""}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="hidden max-w-[16rem] truncate px-4 py-2.5 text-[var(--text-muted)] sm:table-cell">
                    {u.email || "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleChip role={u.role} />
                  </td>
                  {!team ? (
                    <td className="hidden px-4 py-2.5 text-xs text-[var(--text-muted)] md:table-cell">
                      {u.team ?? "—"}
                    </td>
                  ) : null}
                  <td className="hidden px-4 py-2.5 text-xs text-[var(--text-muted)] lg:table-cell">
                    {relative(u.password_changed_at)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Icon
                      name="chevron-right"
                      size={14}
                      className="text-[var(--text-subtle)]"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <UserDrawer
        state={drawer}
        teams={teams}
        assignableRoles={assignableRoles}
        defaultTeam={team || sessionTeam}
        isSelf={drawer?.user?.id === sessionUserId}
        busy={busy}
        onClose={() => setDrawer(null)}
        onSave={(f) => void save(f)}
        onResetPassword={() =>
          drawer?.user && setConfirm({ kind: "reset", user: drawer.user })
        }
        onDelete={() => drawer?.user && setConfirm({ kind: "delete", user: drawer.user })}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "delete" ? "Delete user?" : "Reset password?"}
        body={
          confirm?.kind === "delete" ? (
            <>
              <strong>{confirm.user.username}</strong> will lose access immediately. The
              record is kept with a <code>deleted_at</code> stamp for the audit trail.
            </>
          ) : (
            <>
              A one-time temporary password will be generated for{" "}
              <strong>{confirm?.user.username}</strong> and they must change it at next
              sign-in. Their current password stops working.
            </>
          )
        }
        confirmLabel={confirm?.kind === "delete" ? "Delete" : "Reset password"}
        tone={confirm?.kind === "delete" ? "danger" : "default"}
        busy={busy}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirm(null)}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
