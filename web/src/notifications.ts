import { reactive } from 'vue';
import { api, session, storedToken } from './api';
import { alertNow } from './alert-sound';
import { pickup } from './format';

export type NotificationKind =
  | 'ORDER_CLAIMED'
  | 'ORDER_CONFIRMED'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'ORDER_CANCELLED_BY_STAFF'
  | 'ORDER_REOPENED'
  | 'ORDER_RELEASED'
  | 'ORDER_UNCLAIMED'
  | 'ORDER_CHANGED'
  | 'ORDER_CHANGE_ACKED'
  | 'ORDER_SETTLED'
  | 'CONTACT_REVEALED'
  | 'BOOKING_NEW'
  | 'BOOKING_ACCEPTED'
  | 'BOOKING_CANCELLED'
  | 'CARPOOL_SEAT_NEW'
  | 'CARPOOL_SEAT_WAITING'
  | 'CARPOOL_SEAT_CANCELLED'
  | 'CARPOOL_FORMED'
  | 'CARPOOL_CLOSED'
  | 'DEAL_BOOKING_NEW'
  | 'DEAL_BOOKING_ACCEPTED'
  | 'SUPPORT_REPLY';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  orderId: string | null;
  bookingId: string | null;
  /** 拼車 */
  carpoolId?: string | null;
  summary: string;
  pickupAt: string | null;
  read: boolean;
  createdAt: string;
}

const TITLES: Record<NotificationKind, string> = {
  ORDER_CLAIMED: '你出的單有司機接了',
  ORDER_CONFIRMED: '乘客確認了行程',
  ORDER_COMPLETED: '行程已標記完成',
  ORDER_CANCELLED: '你接的單已被取消',
  ORDER_CANCELLED_BY_STAFF: '平台客服代你取消了一張單',
  ORDER_REOPENED: '出單者已改派你接的單',
  ORDER_RELEASED: '接單司機取消了接單，已回到等人搶',
  ORDER_UNCLAIMED: '你出的單還沒人接',
  ORDER_CHANGED: '出單者改了你接的行程，請確認',
  ORDER_CHANGE_ACKED: '接單司機確認了行程修改',
  ORDER_SETTLED: '出單者標記了已結清',
  CONTACT_REVEALED: '現在可以看乘客電話了',
  BOOKING_NEW: '名片頁有客人詢價',
  BOOKING_ACCEPTED: '乘客同意了你的報價',
  BOOKING_CANCELLED: '乘客取消了詢價',
  CARPOOL_SEAT_NEW: '有人報了你的拼車',
  CARPOOL_SEAT_WAITING: '有人報了你的拼車，等你確認',
  CARPOOL_SEAT_CANCELLED: '乘客取消了拼車報位',
  CARPOOL_FORMED: '你的拼車已成行',
  CARPOOL_CLOSED: '你的拼車已截止報位',
  DEAL_BOOKING_NEW: '特價車有人預約，等你確認',
  DEAL_BOOKING_ACCEPTED: '特價車有人訂了，去安排行程',
  SUPPORT_REPLY: '客服回覆了你',
};

/** What a line says, and where tapping it goes (none after 改派: the order is no longer theirs). */
export function describe(item: NotificationItem) {
  const detail = [item.pickupAt ? pickup(item.pickupAt) : '', item.summary].filter(Boolean).join('　');
  const to =
    item.kind === 'SUPPORT_REPLY'
      ? '/support'
      : item.bookingId
        ? `/app/bookings/${item.bookingId}`
        : item.carpoolId
          ? `/app/carpools/${item.carpoolId}`
        : item.orderId && item.kind !== 'ORDER_REOPENED'
          ? `/app/orders/${item.orderId}`
          : null;
  return { title: TITLES[item.kind], detail, to };
}

export const inbox = reactive({
  items: [] as NotificationItem[],
  unread: 0,
  loaded: false,
  /** The line sliding in at the top of the page; null when none. */
  banner: null as NotificationItem | null,
  /** How many arrived together with the banner's line. */
  bannerMore: 0,
});

/** Lines this page has already shown or chosen not to announce. */
const known = new Set<string>();
let primed = false;
let pending: Promise<void> | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | undefined;

function announce(fresh: NotificationItem[]) {
  inbox.banner = fresh[0];
  inbox.bannerMore = fresh.length - 1;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (inbox.banner = null), 6000);
  alertNow();
}

export function closeBanner() {
  clearTimeout(bannerTimer);
  inbox.banner = null;
}

/**
 * Reads the list; calls made while one is in flight share it. What is already there when the
 * page opens is not announced; an unread line that appears later is, once, with the sound.
 */
export function refreshInbox(): Promise<void> {
  if (!session.user) return Promise.resolve();
  pending ??= api<{ items: NotificationItem[]; unread: number }>('GET', '/notifications')
    .then((result) => {
      const fresh = result.items.filter((item) => !item.read && !known.has(item.id));
      for (const item of result.items) known.add(item.id);
      inbox.items = result.items;
      inbox.unread = result.unread;
      inbox.loaded = true;
      if (primed && fresh.length > 0) announce(fresh);
      primed = true;
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
  return pending;
}

export async function markRead(item: NotificationItem) {
  if (item.read) return;
  item.read = true;
  inbox.unread = Math.max(0, inbox.unread - 1);
  const result = await api<{ unread: number }>('POST', '/notifications/read', { id: item.id }).catch(() => null);
  if (result) inbox.unread = result.unread;
}

export async function markAllRead() {
  for (const item of inbox.items) item.read = true;
  inbox.unread = 0;
  const result = await api<{ unread: number }>('POST', '/notifications/read', { all: true }).catch(() => null);
  if (result) inbox.unread = result.unread;
}

// ---------------------------------------------------------------------------
// Delivery while the page is open: a stream that only says "changed", read with fetch so the
// sign-in token goes in a header. Where the stream does not work, the list is read every
// half minute instead. Nothing runs while the page is hidden; coming back reads at once.
// ---------------------------------------------------------------------------

const POLL_MS = 30_000;
const RETRY_MS = 15_000;

let running = false;
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let changedTimer: ReturnType<typeof setTimeout> | undefined;

/** Several "changed" in a row (one per instance that saw it) read the list once. */
function changed() {
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => void refreshInbox(), 300);
}

function startPolling() {
  pollTimer ??= setInterval(() => void refreshInbox(), POLL_MS);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = undefined;
}

async function listen() {
  if (!running || !session.user || document.visibilityState === 'hidden') return;
  controller = new AbortController();
  const signal = controller.signal;
  let opened = false;
  try {
    const bearer = storedToken();
    const response = await fetch('/api/notifications/stream', {
      credentials: 'same-origin',
      headers: { accept: 'text/event-stream', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
    opened = true;
    stopPolling();
    void refreshInbox();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^event: changed$/m.test(block)) changed();
      }
    }
  } catch {
    if (signal.aborted) return;
  }
  if (!running || signal.aborted) return;
  // The server ends each stream after a while: open the next one at once. A stream that could
  // not open falls back to reading the list until the next try.
  if (opened) {
    void listen();
  } else {
    startPolling();
    void refreshInbox();
    retryTimer = setTimeout(() => void listen(), RETRY_MS);
  }
}

function pause() {
  clearTimeout(retryTimer);
  stopPolling();
  controller?.abort();
  controller = null;
}

function onVisibility() {
  if (!running) return;
  if (document.visibilityState === 'hidden') {
    pause();
  } else if (!controller || controller.signal.aborted) {
    void refreshInbox();
    void listen();
  }
}

/** Starts delivery for the signed-in user; safe to call again. */
export function startNotifications() {
  if (running || !session.user) return;
  running = true;
  document.addEventListener('visibilitychange', onVisibility);
  void refreshInbox();
  void listen();
}

/** Stops delivery and forgets the list (signing out, or another account signing in). */
export function stopNotifications() {
  running = false;
  document.removeEventListener('visibilitychange', onVisibility);
  pause();
  known.clear();
  primed = false;
  inbox.items = [];
  inbox.unread = 0;
  inbox.loaded = false;
  closeBanner();
}
