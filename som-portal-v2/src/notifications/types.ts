// som-portal-v2/src/notifications/types.ts
// Zod schemas for user notifications — v1 parity with api/notifications/index.php.

import { z } from 'zod';

export const NotificationSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  type: z.string().default('general'),
  title: z.string(),
  body: z.string().default(''),
  link: z.string().default(''),
  read: z.boolean().default(false),
  created_at: z.string(),
});

export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationsFileSchema = z.array(NotificationSchema).default([]);
export type NotificationsFile = z.infer<typeof NotificationsFileSchema>;

export const NOTIFICATIONS_FILE = 'notifications.json';
