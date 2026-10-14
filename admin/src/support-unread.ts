import { reactive } from 'vue';
import { api, can } from './api';

/** 客服 conversations with a message no staff member has opened yet, shown beside 客服 in the side navigation. */
export const supportUnread = reactive<{ count: number | null }>({ count: null });

const POLL_MS = 30_000;
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  if (!can.write()) return;
  try {
    supportUnread.count = (await api<{ unread: number }>('GET', '/support/conversations?filter=waiting')).unread;
  } catch {
    // The count is a hint; the 客服 page shows the real inbox.
  }
}

const onVisible = () => document.hidden || void refresh();

/** Polls while an operator is signed in; the 客服 page sets the count itself as it reads the inbox. */
export function watchSupportUnread(on: boolean) {
  clearInterval(timer);
  timer = undefined;
  if (!on) {
    supportUnread.count = null;
    document.removeEventListener('visibilitychange', onVisible);
    return;
  }
  void refresh();
  // A tab left in the background stops asking, and asks again as soon as it is looked at.
  timer = setInterval(onVisible, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
}
