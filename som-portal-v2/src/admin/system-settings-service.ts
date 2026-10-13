// som-portal-v2/src/admin/system-settings-service.ts
//
// Ported from v1 `api/system-settings/index.php`.
//   • GET  — any authenticated user (the login page needs `site_name`).
//   • PUT  — ADMIN_ROLES only. v2 exposes it as PATCH (partial merge), which is
//            what v1 actually did (it merged the body into the current file).
//   • `system-settings.json` is a GLOBAL file (api/helpers.php _isGlobalFile),
//     so there is exactly one platform-wide copy — NOT per team. Only
//     super_admin may edit the platform-wide rate limits / session policy;
//     team admins may edit the presentation fields.
import { z } from 'zod';
import type { Session } from '@/auth/session';
import { ForbiddenError } from '@/lib/errors';
import { readGlobalFile, writeGlobalFile } from '@/data/global-store';
import { logActivity } from '@/logging/activity';

export const SETTINGS_DEFAULTS = {
  site_name: 'SOM-Portal',
  site_tagline: 'Service Operations Management',
  session_timeout_hours: 8,
  remember_me_days: 30,
  password_expiry_days: 60,
  password_history_count: 5,
  max_login_attempts: 5,
  lockout_minutes: 15,
  api_rate_limit_requests: 120,
  api_rate_limit_window_seconds: 60,
  trash_retention_days: 30,
  enable_markdown: true,
  email_noti_chat_webhooks: [] as string[],
  exam_reminder_chat_webhooks: [] as string[],
};

export type SystemSettings = typeof SETTINGS_DEFAULTS & Record<string, unknown>;

export const SettingsFileSchema = z.record(z.string(), z.unknown()).default({});

export const STRING_KEYS = ['site_name', 'site_tagline'] as const;
export const BOOL_KEYS = ['enable_markdown'] as const;
export const URL_KEYS = ['email_noti_chat_webhooks', 'exam_reminder_chat_webhooks'] as const;

/** v1 int keys with their clamp ranges (guard clamps at the bottom of the PHP). */
export const INT_KEYS = {
  session_timeout_hours: [1, 168],
  remember_me_days: [1, 90],
  password_expiry_days: [7, 365],
  password_history_count: [1, 20],
  max_login_attempts: [3, 20],
  lockout_minutes: [5, 1440],
  api_rate_limit_requests: [10, 1000],
  api_rate_limit_window_seconds: [10, 3600],
  trash_retention_days: [1, 365],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * Platform-wide security policy — a team admin must not be able to widen the
 * login lockout or the API rate limit for every other team. v1 let any
 * ADMIN_ROLE write these; v2 tightens it to super_admin, which matches the
 * multi-team model (sm_admin owns its team, super_admin owns the platform).
 */
export const SUPER_ADMIN_ONLY_KEYS = [
  'session_timeout_hours',
  'remember_me_days',
  'password_expiry_days',
  'password_history_count',
  'max_login_attempts',
  'lockout_minutes',
  'api_rate_limit_requests',
  'api_rate_limit_window_seconds',
] as const;

export const ADMIN_ROLES = ['super_admin', 'sm_admin', 'dev_sm'] as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export async function getSettings(): Promise<SystemSettings> {
  const raw = await readGlobalFile('system-settings.json', SettingsFileSchema);
  return { ...SETTINGS_DEFAULTS, ...raw } as SystemSettings;
}

export function sanitiseWebhooks(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  for (const item of list) {
    const u = String(item ?? '').trim();
    if (!u) continue;
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    // v1 only accepts Google Chat webhook hosts.
    if (!parsed.hostname.endsWith('chat.googleapis.com')) continue;
    seen.add(u);
  }
  return [...seen];
}

export interface ApplyResult {
  settings: SystemSettings;
  changed: string[];
  rejected: string[];
}

/**
 * Merge a partial patch into the current settings, applying v1 coercion +
 * clamps. Keys the session may not edit are reported in `rejected` rather than
 * failing the whole request — except when the patch contains *only* forbidden
 * keys, where callers should surface a 403.
 */
export function applySettingsPatch(
  current: SystemSettings,
  patch: Record<string, unknown>,
  session: Session,
): ApplyResult {
  const isSuper = session.role === 'super_admin';
  const next: SystemSettings = { ...current };
  const changed: string[] = [];
  const rejected: string[] = [];

  const forbidden = (key: string): boolean =>
    !isSuper && (SUPER_ADMIN_ONLY_KEYS as readonly string[]).includes(key);

  for (const key of STRING_KEYS) {
    if (!(key in patch)) continue;
    if (forbidden(key)) {
      rejected.push(key);
      continue;
    }
    const v = String(patch[key] ?? '').trim();
    if (v !== '') {
      next[key] = v;
      changed.push(key);
    }
  }

  for (const [key, [lo, hi]] of Object.entries(INT_KEYS)) {
    if (!(key in patch)) continue;
    if (forbidden(key)) {
      rejected.push(key);
      continue;
    }
    const n = Number(patch[key]);
    // v1: `max(1, (int)$body[$k])` then a per-key clamp. NaN → the default.
    const base = Number.isFinite(n) ? Math.trunc(n) : Number(SETTINGS_DEFAULTS[key as never]);
    next[key] = clamp(base, lo, hi);
    changed.push(key);
  }

  for (const key of BOOL_KEYS) {
    if (!(key in patch)) continue;
    if (forbidden(key)) {
      rejected.push(key);
      continue;
    }
    next[key] = Boolean(patch[key]);
    changed.push(key);
  }

  for (const key of URL_KEYS) {
    if (!(key in patch)) continue;
    if (forbidden(key)) {
      rejected.push(key);
      continue;
    }
    next[key] = sanitiseWebhooks(patch[key]);
    changed.push(key);
  }

  return { settings: next, changed, rejected };
}

export async function updateSettings(
  session: Session,
  patch: Record<string, unknown>,
): Promise<ApplyResult> {
  if (!(ADMIN_ROLES as readonly string[]).includes(session.role)) {
    throw new ForbiddenError('Forbidden: insufficient permissions');
  }
  const current = await getSettings();
  const result = applySettingsPatch(current, patch, session);
  if (result.changed.length === 0 && result.rejected.length > 0) {
    throw new ForbiddenError(
      `Only super_admin can change: ${result.rejected.join(', ')}`,
    );
  }
  if (result.changed.length > 0) {
    await writeGlobalFile('system-settings.json', result.settings, SettingsFileSchema);
    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'settings_update',
      meta: { changed: result.changed, rejected: result.rejected },
    });
  }
  return result;
}
