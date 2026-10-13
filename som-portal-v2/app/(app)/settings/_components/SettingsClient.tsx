"use client";

// som-portal-v2/app/(app)/settings/_components/SettingsClient.tsx
//
// Tabbed settings shell: left rail of tabs, right content pane.
// Theme changes apply to the DOM IMMEDIATELY (useTheme) and are persisted to
// `data/<team>/user-prefs.json` in the background — a failed persist rolls the
// UI notice, not the applied theme.

import * as React from "react";
import { useTheme, ALL_THEMES, type ThemeName, type ModeName } from "@/theme";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import { Icon, type IconName } from "@/icons";
import { cn } from "@/ui/cn";
import { passwordStrength, PW_MIN_LENGTH } from "@/account/password-policy";

export type NotificationChannel = "board" | "jira" | "jenkins" | "incident";

interface ProfileDto {
  id: string;
  name: string;
  nickname: string;
  username: string;
  email: string;
  role: string;
  avatar_url: string;
  name_th: string;
  emp_id: string;
  phone: string;
  tmn_id: string;
  net_home: string;
  net_mobile: string;
}

interface PrefsDto {
  theme: ThemeName;
  mode: ModeName;
  genz_overlay: boolean;
  notifications: Record<NotificationChannel, boolean>;
  sessions_revoked_at: string | null;
  updated_at: string | null;
}

interface ChannelMeta {
  key: NotificationChannel;
  label: string;
  description: string;
}

export interface SettingsClientProps {
  profile: ProfileDto;
  prefs: PrefsDto;
  channels: readonly ChannelMeta[];
  team: string;
  role: string;
  canUseGenzOverlay: boolean;
  pwChangeRequired: boolean;
}

type TabId = "appearance" | "profile" | "password" | "notifications" | "sessions";

const TABS: ReadonlyArray<{ id: TabId; label: string; icon: IconName }> = [
  { id: "appearance", label: "Appearance", icon: "sparkles" },
  { id: "profile", label: "Profile", icon: "user" },
  { id: "password", label: "Password", icon: "shield" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "sessions", label: "Sessions", icon: "server" },
];

const THEME_META: Record<ThemeName, { label: string; blurb: string; swatch: string[] }> = {
  glass: { label: "Glass", blurb: "Translucent surfaces, soft blurs", swatch: ["#e7eef7", "#b9cde4", "#5b7fa6"] },
  enterprise: { label: "Enterprise", blurb: "Clean, neutral, high density", swatch: ["#ffffff", "#e2e8f0", "#F26419"] },
  console: { label: "Console", blurb: "Terminal flavour — always dark", swatch: ["#0b0f14", "#1b2430", "#35d07f"] },
  warm: { label: "Warm", blurb: "Earthy tones, soft contrast", swatch: ["#f8f3ea", "#e7d8c3", "#b4631f"] },
};

async function apiPatch(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
    const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? `Request failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

async function apiPost(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
    const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? `Request failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

export function SettingsClient({
  profile,
  prefs,
  channels,
  team,
  role,
  canUseGenzOverlay,
  pwChangeRequired,
}: SettingsClientProps) {
  const [tab, setTab] = React.useState<TabId>(pwChangeRequired ? "password" : "appearance");

  return (
    <div className="flex flex-col gap-5">
      {pwChangeRequired ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border px-4 py-3 text-sm"
          style={{
            borderColor: "oklch(from var(--state-warning) l c h / 0.5)",
            background: "oklch(from var(--state-warning) l c h / 0.1)",
          }}
        >
          <p className="font-semibold">Please set a new password to continue.</p>
          <p className="text-xs text-[var(--text-muted)]">
            Your password was reset, has expired, or this is your first sign-in. The rest of the portal unlocks after you change it.
          </p>
        </div>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--text-strong)]">Settings</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Appearance, profile, security and notifications for{" "}
            <span className="font-medium text-[var(--text)]">{profile.username}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1">team · {team}</span>
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{role}</span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,210px)_minmax(0,1fr)]">
        {/* LEFT: tab rail */}
        <nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-[var(--radius)] border px-3 py-2 text-sm",
                  "transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                  active
                    ? "border-[var(--accent)] bg-[var(--bg-raised)] font-medium text-[var(--text-strong)]"
                    : "border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:bg-[var(--bg-raised)]",
                )}
              >
                <Icon name={t.icon} size={15} className={active ? "text-[var(--accent)]" : undefined} />
                <span className="whitespace-nowrap">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* RIGHT: panes */}
        <div className="min-w-0">
          {tab === "appearance" ? (
            <AppearanceTab initial={prefs} canUseGenzOverlay={canUseGenzOverlay} />
          ) : null}
          {tab === "profile" ? <ProfileTab initial={profile} /> : null}
          {tab === "password" ? <PasswordTab /> : null}
          {tab === "notifications" ? (
            <NotificationsTab initial={prefs.notifications} channels={channels} />
          ) : null}
          {tab === "sessions" ? <SessionsTab revokedAt={prefs.sessions_revoked_at} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Appearance ─────────────────────────── */

function AppearanceTab({
  initial,
  canUseGenzOverlay,
}: {
  initial: PrefsDto;
  canUseGenzOverlay: boolean;
}) {
  const { theme, mode, setTheme, setMode } = useTheme();
  const [genzOverlay, setGenzOverlay] = React.useState(initial.genz_overlay);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const persist = React.useCallback(async (patch: Record<string, unknown>) => {
    setError(null);
    const res = await apiPatch("/v2/api/v1/user-prefs", patch);
    if (!res.ok) {
      setError(res.error ?? "Could not save preference");
      setStatus(null);
      return;
    }
    setStatus("Saved");
    window.setTimeout(() => setStatus(null), 1800);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Theme</CardTitle>
            <CardDescription>
              Applies instantly and is remembered on this account. Console is always dark.
            </CardDescription>
          </div>
          <SaveBadge status={status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive" role="alert">
              <Icon name="alert-triangle" size={15} />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div
            className="grid gap-3"
            data-testid="theme-grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}
          >
            {ALL_THEMES.map((t) => {
              const meta = THEME_META[t];
              const active = t === theme;
              return (
                <button
                  key={t}
                  type="button"
                  data-testid={`theme-${t}`}
                  aria-pressed={active}
                  onClick={() => {
                    setTheme(t);
                    const nextMode: ModeName = t === "console" ? "dark" : mode;
                    void persist({ theme: t, mode: nextMode });
                  }}
                  className={cn(
                    "flex min-w-0 flex-col gap-2 rounded-[var(--radius)] border bg-[var(--bg-raised)] p-3 text-left",
                    "transition-[background-color,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    active
                      ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                      : "border-[var(--border)] hover:border-[var(--border-strong)]",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--text-strong)]">{meta.label}</span>
                    {active ? <Icon name="check" size={14} className="text-[var(--accent)]" /> : null}
                  </span>
                  <span className="flex h-7 overflow-hidden rounded-[var(--radius-sm,4px)] border border-[var(--border)]">
                    {meta.swatch.map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-xs leading-snug text-[var(--text-muted)]">{meta.blurb}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text-strong)]">Mode</div>
              <div className="text-xs text-[var(--text-muted)]">
                {theme === "console"
                  ? "Console forces dark mode"
                  : `Currently ${mode}. Switch between light and dark.`}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              data-testid="mode-toggle"
              disabled={theme === "console"}
              onClick={() => {
                const next: ModeName = mode === "dark" ? "light" : "dark";
                setMode(next);
                void persist({ mode: next });
              }}
            >
              <Icon name={mode === "dark" ? "sun" : "moon"} size={14} />
              {mode === "dark" ? "Light" : "Dark"}
            </Button>
          </div>

          {canUseGenzOverlay ? (
            <ToggleRow
              label="GenZ overlay"
              description="Purple/pink accent layer on top of the active theme"
              checked={genzOverlay}
              testId="genz-overlay"
              onChange={(v) => {
                setGenzOverlay(v);
                document.body.toggleAttribute("data-user-genz", v);
                void persist({ genz_overlay: v });
              }}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Profile ─────────────────────────── */

function ProfileTab({ initial }: { initial: ProfileDto }) {
  const [form, setForm] = React.useState({
    name: initial.name,
    nickname: initial.nickname,
    email: initial.email,
    phone: initial.phone,
    emp_id: initial.emp_id,
    name_th: initial.name_th,
  });
  const [avatar, setAvatar] = React.useState(initial.avatar_url);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  function field<K extends keyof typeof form>(key: K) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // ~200 KB raw → base64 inflates ~33%; v1 caps the data URI at 280 000 chars.
    if (file.size > 200 * 1024) {
      setError("Avatar too large (max ~200 KB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    setStatus(null);
    const res = await apiPatch("/v2/api/v1/auth/profile", { ...form, avatar_url: avatar });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save profile");
      return;
    }
    setStatus("Profile updated");
    window.setTimeout(() => setStatus(null), 2200);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Profile</CardTitle>
          <CardDescription>Shown on board posts, comments and the team directory.</CardDescription>
        </div>
        <SaveBadge status={status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive" role="alert">
            <Icon name="alert-triangle" size={15} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg-raised)]"
            aria-hidden
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="user" size={24} className="text-[var(--text-subtle)]" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg-raised)]">
              <Icon name="pencil" size={13} />
              Change avatar
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={onAvatar} />
            </label>
            {avatar ? (
              <button
                type="button"
                className="w-fit text-xs text-[var(--text-muted)] underline"
                onClick={() => setAvatar("")}
              >
                Remove avatar
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))" }}>
          <Labelled label="Display name"><Input maxLength={60} {...field("name")} /></Labelled>
          <Labelled label="Nickname"><Input maxLength={30} {...field("nickname")} /></Labelled>
          <Labelled label="Thai name"><Input maxLength={80} {...field("name_th")} /></Labelled>
          <Labelled label="Email"><Input type="email" {...field("email")} /></Labelled>
          <Labelled label="Phone"><Input maxLength={20} {...field("phone")} /></Labelled>
          <Labelled label="Employee ID"><Input maxLength={20} {...field("emp_id")} /></Labelled>
          <Labelled label="Username" hint="Managed by your SM admin">
            <Input value={initial.username} disabled readOnly />
          </Labelled>
          <Labelled label="Role" hint="Managed by your SM admin">
            <Input value={initial.role} disabled readOnly />
          </Labelled>
        </div>

        <div>
          <Button onClick={onSave} disabled={busy}>
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="check" size={14} />}
            Save profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Password ─────────────────────────── */

function PasswordTab() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  const strength = passwordStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    const res = await apiPost("/v2/api/v1/auth/change-password", {
      old_password: current,
      new_password: next,
      confirm_password: confirm,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not change password");
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setStatus("Password changed");
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Password</CardTitle>
          <CardDescription>
            Minimum {PW_MIN_LENGTH} characters with an uppercase letter and a digit. You cannot
            reuse a recent password.
          </CardDescription>
        </div>
        <SaveBadge status={status} />
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
          {error ? (
            <Alert variant="destructive" role="alert">
              <Icon name="alert-triangle" size={15} />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Labelled label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              data-testid="pw-current"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Labelled>
          <Labelled label="New password">
            <Input
              type="password"
              autoComplete="new-password"
              data-testid="pw-new"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Labelled>
          {next ? <StrengthMeter value={next} /> : null}
          <Labelled label="Confirm new password" hint={mismatch ? "Passwords do not match" : undefined}>
            <Input
              type="password"
              autoComplete="new-password"
              data-testid="pw-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Labelled>

          <div>
            <Button
              type="submit"
              data-testid="pw-submit"
              disabled={busy || !strength.met.length || !strength.met.upper || !strength.met.digit || mismatch}
            >
              {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="shield" size={14} />}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Notifications ─────────────────────────── */

function NotificationsTab({
  initial,
  channels,
}: {
  initial: Record<NotificationChannel, boolean>;
  channels: readonly ChannelMeta[];
}) {
  const [state, setState] = React.useState(initial);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle(key: NotificationChannel, value: boolean) {
    setState((s) => ({ ...s, [key]: value }));
    setError(null);
    const res = await apiPatch("/v2/api/v1/user-prefs", { notifications: { [key]: value } });
    if (!res.ok) {
      setState((s) => ({ ...s, [key]: !value }));
      setError(res.error ?? "Could not save preference");
      return;
    }
    setStatus("Saved");
    window.setTimeout(() => setStatus(null), 1800);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Notifications</CardTitle>
          <CardDescription>
            Only the channels your team and role can access are listed here.
          </CardDescription>
        </div>
        <SaveBadge status={status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive" role="alert">
            <Icon name="alert-triangle" size={15} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {channels.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No notification channels are available for your team yet.
          </p>
        ) : (
          channels.map((c) => (
            <ToggleRow
              key={c.key}
              label={c.label}
              description={c.description}
              checked={state[c.key]}
              testId={`noti-${c.key}`}
              onChange={(v) => void toggle(c.key, v)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Sessions ─────────────────────────── */

function SessionsTab({ revokedAt }: { revokedAt: string | null }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function signOutEverywhere() {
    setBusy(true);
    setError(null);
    const res = await apiPost("/v2/api/v1/auth/sign-out-everywhere", {});
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not sign out");
      return;
    }
    window.location.assign("/v2/login");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Sessions</CardTitle>
        <CardDescription>This browser&apos;s session and account-wide sign-out.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive" role="alert">
            <Icon name="alert-triangle" size={15} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] p-3">
          <div className="flex min-w-0 items-center gap-3">
            <Icon name="check-circle" size={18} className="text-[var(--state-success)]" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text-strong)]">This device</div>
              <div className="truncate text-xs text-[var(--text-muted)]">
                Active now · HttpOnly session cookie
              </div>
            </div>
          </div>
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
            current
          </span>
        </div>

        <Alert>
          <Icon name="info" size={15} />
          <AlertDescription>
            SOM sessions are stateless JWTs, so there is no server-side list of other devices.
            Signing out everywhere stamps a revocation time on your account and clears this
            browser; tokens already issued elsewhere stop working when they expire
            {revokedAt ? ` (last revoked ${revokedAt})` : ""}.
          </AlertDescription>
        </Alert>

        <div>
          <Button variant="destructive" onClick={signOutEverywhere} disabled={busy} data-testid="signout-all">
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="logout" size={14} />}
            Sign out everywhere
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Shared bits ─────────────────────────── */

function SaveBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--state-success)]/40 bg-[var(--state-success)]/10 px-2.5 py-1 text-xs text-[var(--state-success)]">
      <Icon name="check" size={12} />
      {status}
    </span>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[var(--text-subtle)]">{hint}</span> : null}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  testId,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--text-strong)]">{label}</div>
        <div className="text-xs text-[var(--text-muted)]">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-fast)]",
          checked
            ? "border-[var(--accent)] bg-[var(--accent)]"
            : "border-[var(--border-strong)] bg-[var(--bg-raised)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-[left] duration-[var(--dur-fast)]",
            checked ? "left-[22px]" : "left-0.5",
          )}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}

export function StrengthMeter({ value }: { value: string }) {
  const s = passwordStrength(value);
  const tone =
    s.label === "weak"
      ? "var(--state-danger)"
      : s.label === "fair"
        ? "var(--state-warning)"
        : s.label === "good"
          ? "var(--state-info)"
          : "var(--state-success)";
  return (
    <div className="flex flex-col gap-1.5" data-testid="strength-meter" data-strength={s.label}>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: i < s.score ? tone : "var(--border)" }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
        <span style={{ color: tone }} className="font-medium capitalize">{s.label}</span>
        <Req ok={s.met.length} text={`${PW_MIN_LENGTH}+ chars`} />
        <Req ok={s.met.upper} text="uppercase" />
        <Req ok={s.met.digit} text="digit" />
        <Req ok={s.met.symbol} text="symbol" />
      </div>
    </div>
  );
}

function Req({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon
        name={ok ? "check" : "x"}
        size={11}
        className={ok ? "text-[var(--state-success)]" : "text-[var(--text-subtle)]"}
      />
      {text}
    </span>
  );
}
