import { z } from 'zod';

/** The groups a user can turn off in 通知設定; NotificationGroup in the schema. */
export const NOTIFICATION_GROUPS = ['DISPATCHED', 'CLAIMED', 'BOOKINGS', 'SUPPORT'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/** How many notifications the list returns, newest first. */
export const NOTIFICATION_PAGE_SIZE = 50;
/** Notifications older than this are removed. */
export const NOTIFICATION_KEEP_DAYS = 90;

export const notificationSettingsSchema = z.object({
  off: z.array(z.enum(NOTIFICATION_GROUPS)).max(NOTIFICATION_GROUPS.length),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** Mark one notification read (`id`), or every one (`all`). */
export const notificationReadSchema = z.union([z.object({ id: z.string().min(1).max(40) }), z.object({ all: z.literal(true) })]);
export type NotificationRead = z.infer<typeof notificationReadSchema>;
