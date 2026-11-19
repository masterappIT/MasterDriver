import { reactive } from 'vue';
import { api, session } from './api';

/**
 * Things waiting for the driver: booking requests from the 名片頁 not yet opened, every 特價車
 * booking still to be made into an order or declined, and 客服 replies not yet read. Shown as numbers only; there are no
 * push messages or SMS. 客服's number comes from the MasterBox chat (masterbox.ts), not from here.
 */
export const unread = reactive({ bookings: 0, deals: 0, support: 0, carpools: 0 });

let pending: Promise<void> | null = null;

/** Refreshes the numbers kept here; calls made while one is in flight share it. */
export function refreshUnread(): Promise<void> {
  if (!session.user) {
    unread.bookings = 0;
    unread.deals = 0;
    unread.carpools = 0;
    return Promise.resolve();
  }
  pending ??= Promise.all([
    api<{ count: number; deals: number }>('GET', '/me/bookings/unread')
      .then((result) => {
        unread.bookings = result.count;
        unread.deals = result.deals;
      })
      .catch(() => undefined),
    // 拼車: seats waiting for the driver's answer that they have not opened yet.
    api<{ count: number }>('GET', '/carpools/unread')
      .then((result) => (unread.carpools = result.count))
      .catch(() => undefined),
  ]).then(() => {
    pending = null;
  });
  return pending;
}
