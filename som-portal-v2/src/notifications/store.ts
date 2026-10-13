// som-portal-v2/src/notifications/store.ts
// CRUD for notifications.json — team-scoped via readTeamFile/writeTeamFile.
// v1 parity: api/notifications/index.php

import { readTeamFile, writeTeamFile } from '@/team/scope';
import {
  NotificationsFileSchema,
  NOTIFICATIONS_FILE,
  type Notification,
  type NotificationsFile,
} from './types';

function genId(): string {
  return 'notif_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface ListOpts {
  unreadOnly?: boolean;
  limit?: number;
}

export async function listForUser(
  userId: string,
  opts: ListOpts = {},
): Promise<{ notifications: Notification[]; unread: number }> {
  const all = await readTeamFile<NotificationsFile>(NOTIFICATIONS_FILE, NotificationsFileSchema);
  let mine = all
    .filter((n) => n.user_id === userId)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  const unread = mine.filter((n) => !n.read).length;

  if (opts.unreadOnly) {
    mine = mine.filter((n) => !n.read);
  }

  const limit = opts.limit ?? 50;
  mine = mine.slice(0, limit);

  return { notifications: mine, unread };
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  const all = await readTeamFile<NotificationsFile>(NOTIFICATIONS_FILE, NotificationsFileSchema);
  let changed = false;
  for (const n of all) {
    if (n.user_id === userId && n.id === notificationId) {
      n.read = true;
      changed = true;
      break;
    }
  }
  if (changed) {
    await writeTeamFile(NOTIFICATIONS_FILE, all, NotificationsFileSchema);
  }
}

export async function markAllRead(userId: string): Promise<void> {
  const all = await readTeamFile<NotificationsFile>(NOTIFICATIONS_FILE, NotificationsFileSchema);
  let changed = false;
  for (const n of all) {
    if (n.user_id === userId && !n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) {
    await writeTeamFile(NOTIFICATIONS_FILE, all, NotificationsFileSchema);
  }
}

export async function create(
  notification: Omit<Notification, 'id' | 'created_at' | 'read'>,
): Promise<Notification> {
  const entry: Notification = {
    ...notification,
    id: genId(),
    read: false,
    created_at: new Date().toISOString(),
  };
  const all = await readTeamFile<NotificationsFile>(NOTIFICATIONS_FILE, NotificationsFileSchema);
  all.push(entry);
  await writeTeamFile(NOTIFICATIONS_FILE, all, NotificationsFileSchema);
  return entry;
}

export async function deleteRead(userId: string): Promise<void> {
  const all = await readTeamFile<NotificationsFile>(NOTIFICATIONS_FILE, NotificationsFileSchema);
  const filtered = all.filter((n) => n.user_id !== userId || !n.read);
  await writeTeamFile(NOTIFICATIONS_FILE, filtered, NotificationsFileSchema);
}

export async function deleteOld(days: number): Promise<number> {
  const all = await readTeamFile<NotificationsFile>(NOTIFICATIONS_FILE, NotificationsFileSchema);
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const filtered = all.filter((n) => n.created_at >= cutoff);
  const removed = all.length - filtered.length;
  if (removed > 0) {
    await writeTeamFile(NOTIFICATIONS_FILE, filtered, NotificationsFileSchema);
  }
  return removed;
}
