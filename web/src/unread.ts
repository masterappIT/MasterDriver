import { reactive } from 'vue';
import { api, session } from './api';

/**
 * Things waiting for the driver: booking requests from the 名片頁 not yet opened, and
 * 客服 replies not yet read. Shown as numbers only; there are no push messages or SMS.
 */
export const unread = reactive({ bookings: 0, support: 0 });

let pending: Promise<void> | null = null;

/** Refreshes both numbers; calls made while one is in flight share it. */
export function refreshUnread(): Promise<void> {
  if (!session.user) {
    unread.bookings = 0;
    unread.support = 0;
    return Promise.resolve();
  }
  pending ??= Promise.all([
    api<{ count: number }>('GET', '/me/bookings/unread')
      .then((result) => (unread.bookings = result.count))
      .catch(() => undefined),
    api<{ count: number }>('GET', '/support/unread')
      .then((result) => (unread.support = result.count))
      .catch(() => undefined),
  ]).then(() => {
    pending = null;
  });
  return pending;
}
