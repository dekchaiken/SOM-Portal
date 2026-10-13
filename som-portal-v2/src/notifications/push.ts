// som-portal-v2/src/notifications/push.ts
// Notification creation helpers — used by other modules to push notifications.

import { create } from './store';
import type { Notification } from './types';

export async function notifyUser(
  userId: string,
  opts: { type?: string; title: string; body?: string; link?: string },
): Promise<Notification> {
  return create({
    user_id: userId,
    type: opts.type ?? 'general',
    title: opts.title,
    body: opts.body ?? '',
    link: opts.link ?? '',
  });
}

/**
 * Notify all users with a given role.
 * Caller provides the user list (avoids circular dep on users-store).
 */
export async function notifyRole(
  users: { id: string; role: string }[],
  role: string,
  opts: { type?: string; title: string; body?: string; link?: string },
): Promise<Notification[]> {
  const targets = users.filter((u) => u.role === role);
  return Promise.all(targets.map((u) => notifyUser(u.id, opts)));
}

/**
 * Notify all users on a given team.
 */
export async function notifyTeam(
  users: { id: string; team: string }[],
  team: string,
  opts: { type?: string; title: string; body?: string; link?: string },
): Promise<Notification[]> {
  const targets = users.filter((u) => u.team === team);
  return Promise.all(targets.map((u) => notifyUser(u.id, opts)));
}
