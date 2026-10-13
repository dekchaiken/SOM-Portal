"use client";

import * as React from "react";
import { Icon } from "@/icons";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import type { SafeUser } from "@/admin/users-schema";
import type { TeamOption } from "@/admin/users-service";
import { Avatar, Field, ROLE_LABELS, RoleChip, Select, Toggle } from "./bits";

export interface DrawerState {
  mode: "create" | "edit";
  user: SafeUser | null;
}

export interface SavePayload {
  name: string;
  /** Only used when creating — v1 usernames are immutable. */
  username: string;
  nickname: string;
  email: string;
  role: string;
  team?: string;
  dev_subteam?: string;
  name_th: string;
  emp_id: string;
  phone: string;
  schedule_include: boolean;
  course_include: boolean;
  exam_include: boolean;
  must_reset_password: boolean;
}

const EMPTY: SavePayload = {
  name: "",
  username: "",
  nickname: "",
  email: "",
  role: "sm_user",
  name_th: "",
  emp_id: "",
  phone: "",
  schedule_include: true,
  course_include: true,
  exam_include: true,
  must_reset_password: false,
};

export function UserDrawer({
  state,
  teams,
  assignableRoles,
  defaultTeam,
  isSelf,
  busy,
  onClose,
  onSave,
  onResetPassword,
  onDelete,
}: {
  state: DrawerState | null;
  teams: TeamOption[];
  assignableRoles: string[];
  defaultTeam: string;
  isSelf: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (p: SavePayload) => void;
  onResetPassword: () => void;
  onDelete: () => void;
}) {
  const [form, setForm] = React.useState<SavePayload>(EMPTY);

  React.useEffect(() => {
    if (!state) return;
    if (state.mode === "create" || !state.user) {
      setForm({
        ...EMPTY,
        role: assignableRoles[0] ?? "sm_user",
        team: defaultTeam,
      });
      return;
    }
    const u = state.user;
    setForm({
      name: u.name,
      username: u.username,
      nickname: u.nickname,
      email: u.email,
      role: u.role,
      team: u.team ?? defaultTeam,
      dev_subteam: u.dev_subteam ?? "",
      name_th: u.name_th,
      emp_id: u.emp_id,
      phone: u.phone,
      schedule_include: u.schedule_include,
      course_include: u.course_include,
      exam_include: u.exam_include,
      must_reset_password: u.must_reset_password,
    });
  }, [state, assignableRoles, defaultTeam]);

  React.useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  if (!state) return null;
  const creating = state.mode === "create";
  const u = state.user;
  // Role is immutable in the UI when it isn't one you're allowed to grant
  // (e.g. an sm_admin looking at a super_admin record).
  const roleLocked = !creating && !!u && !assignableRoles.includes(u.role);
  const set = <K extends keyof SavePayload>(k: K, v: SavePayload[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        style={{ fontFamily: "inherit" }}
      />
      <aside
        data-testid="user-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={creating ? "Add user" : `Edit ${u?.username ?? "user"}`}
        className="drawer-in relative flex h-full w-[min(100vw,30rem)] flex-col border-l shadow-2xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <header
          className="flex items-center gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <Avatar
            name={form.name}
            username={u?.username ?? form.name}
            src={u?.avatar_url}
            size={40}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--text-strong)]">
              {creating ? "Add user" : form.name || u?.username}
            </h2>
            <p className="truncate text-xs text-[var(--text-muted)]">
              {creating ? "Creates an account with a temporary password" : `@${u?.username}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--text-subtle)] hover:text-[var(--text)]"
            style={{ fontFamily: "inherit" }}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
              Identity
            </h3>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr))]">
              <Field label="Full name">
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Somchai Jaidee"
                  data-testid="field-name"
                />
              </Field>
              <Field label="Nickname">
                <Input
                  value={form.nickname}
                  onChange={(e) => set("nickname", e.target.value)}
                  placeholder="Chai"
                />
              </Field>
              <Field label="Thai name">
                <Input
                  value={form.name_th}
                  onChange={(e) => set("name_th", e.target.value)}
                />
              </Field>
              <Field label="Employee ID">
                <Input value={form.emp_id} onChange={(e) => set("emp_id", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Email" hint="Temporary password is addressed here">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="name@ascendcorp.com"
                  data-testid="field-email"
                />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
              Account
            </h3>
            {creating ? (
              <Field label="Username" hint="Letters, digits, dot, dash, underscore">
                <Input
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                  placeholder="somchai.jai"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-testid="field-username"
                />
              </Field>
            ) : null}
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr))]">
              <Field
                label="Role"
                hint={roleLocked ? "Your role cannot change this user's role" : undefined}
              >
                {roleLocked ? (
                  <div className="flex h-9 items-center">
                    <RoleChip role={form.role} />
                  </div>
                ) : (
                  <Select
                    value={form.role}
                    onChange={(e) => set("role", e.target.value)}
                    data-testid="field-role"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r] ?? r}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {teams.length > 1 ? (
                <Field
                  label="Team"
                  hint={
                    form.role === "dev_user"
                      ? "dev_user is always homed to the dev team"
                      : undefined
                  }
                >
                  <Select
                    value={form.role === "dev_user" ? "dev" : (form.team ?? defaultTeam)}
                    disabled={!creating || form.role === "dev_user"}
                    onChange={(e) => set("team", e.target.value)}
                    data-testid="field-team"
                  >
                    {teams
                      .filter((t) => t.active || t.slug === form.team)
                      .map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : null}
              {form.role === "dev_user" ? (
                <Field label="Dev sub-team">
                  <Input
                    value={form.dev_subteam ?? ""}
                    onChange={(e) => set("dev_subteam", e.target.value)}
                  />
                </Field>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2.5 pt-1">
              <Toggle
                label="Include in schedule"
                checked={form.schedule_include}
                disabled={form.role === "external" || form.role === "dev_user"}
                onChange={(v) => set("schedule_include", v)}
              />
              <Toggle
                label="Include in courses"
                checked={form.course_include}
                disabled={form.role === "external" || form.role === "dev_user"}
                onChange={(v) => set("course_include", v)}
              />
              <Toggle
                label="Include in exams"
                checked={form.exam_include}
                disabled={form.role === "external" || form.role === "dev_user"}
                onChange={(v) => set("exam_include", v)}
              />
            </div>
          </section>

          {!creating && u ? (
            <section className="flex flex-col gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
                Password actions
              </h3>
              <Toggle
                label="Force password change at next sign-in"
                checked={form.must_reset_password}
                onChange={(v) => set("must_reset_password", v)}
              />
              <dl className="grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
                <div>
                  <dt className="text-[var(--text-subtle)]">Password changed</dt>
                  <dd>{u.password_changed_at ? u.password_changed_at.slice(0, 10) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-subtle)]">Created</dt>
                  <dd>{u.created_at ? u.created_at.slice(0, 10) : "—"}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onResetPassword}
                  disabled={busy}
                  data-testid="reset-password"
                >
                  <Icon name="refresh" size={14} /> Reset password
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={busy || isSelf}
                  data-testid="delete-user"
                >
                  <Icon name="trash" size={14} /> Delete user
                </Button>
              </div>
              {isSelf ? (
                <p className="text-[11px] text-[var(--text-subtle)]">
                  You cannot delete or demote your own account.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={busy} data-testid="save-user">
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : null}
            {creating ? "Create user" : "Save changes"}
          </Button>
        </footer>

        <style>{`
          .drawer-in { animation: drawer-slide 260ms cubic-bezier(0.22,1,0.36,1) both; }
          @keyframes drawer-slide { from { transform: translateX(16px); opacity: 0 } to { transform: none; opacity: 1 } }
          @media (prefers-reduced-motion: reduce) { .drawer-in { animation: none } }
        `}</style>
      </aside>
    </div>
  );
}
