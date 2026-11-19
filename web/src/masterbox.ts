import { reactive, watch } from 'vue';
import { api, session } from './api';
import { language } from './i18n';
import { unread } from './unread';

/**
 * 客服 is MasterBox Chat Box (2026-11-18): its website widget in 嵌入模式 (data-container, 2026-11-19). The chat sits in
 * #support-chat, a block index.html keeps outside the app so it is never taken away: off screen, except while the
 * 客服 page (SupportChatPage.vue) shows it below its own header. The widget only finds its block when it loads and
 * counts messages as read while half the block is on screen, so the block is always there and the widget is told
 * (a resize) whenever it comes or goes.
 *
 * The widget is loaded when it is needed, not with every page: a signed-in driver's at once (their red dot, on any
 * phone), with the credential our API signs; a visitor's only on opening 客服, as in 嵌入模式 the chat is made as
 * soon as the widget loads.
 *
 * window.MasterBoxChat is a list of commands until widget.js has loaded and its API after; push works on both.
 */
const SCRIPT = 'https://masterboxapp.masterappinc.com/c/widget.js';
const LINK = 'tSUBL-vltmvYVArtvkzXCZxd';
const BLOCK_ID = 'support-chat';

type Command = [string, ...unknown[]];
interface Widget {
  push(...commands: Command[]): unknown;
}

function widget(): Widget {
  const holder = window as unknown as { MasterBoxChat?: Widget };
  holder.MasterBoxChat ??= [] as Command[];
  return holder.MasterBoxChat;
}
const send = (...command: Command) => widget().push(command);

/** What the 客服 page shows: 'loading' until the widget is in its block, 'failed' when it could not be loaded. */
export const supportChat = reactive({ state: 'idle' as 'idle' | 'loading' | 'ready' | 'failed' });

/** How long to wait for widget.js on a slow network before saying 客服 cannot open. */
const READY_WAIT_MS = 10000;
let loaded = false;
let ready = false;
let readyTimer: ReturnType<typeof setTimeout> | undefined;
/** Whose chat the widget has: a driver's id, or null for a visitor. */
let loadedFor: string | null = null;
/** True once this server said it has no MasterBox key: drivers chat as visitors and it is not asked again. */
let notConfigured = false;

function load(token: string | null) {
  if (loaded) return;
  loaded = true;
  supportChat.state = 'loading';
  readyTimer = setTimeout(() => {
    if (!ready) supportChat.state = 'failed';
  }, READY_WAIT_MS);
  const script = document.createElement('script');
  script.src = SCRIPT;
  script.async = true;
  script.dataset.link = LINK;
  script.dataset.container = `#${BLOCK_ID}`;
  script.dataset.button = 'none';
  script.dataset.src = 'masterdriver';
  script.dataset.locale = language.value;
  // Given as data-token rather than setToken: the chat is made once, as the driver, not first as a visitor.
  if (token) script.dataset.token = token;
  script.onerror = () => {
    clearTimeout(readyTimer);
    supportChat.state = 'failed';
  };
  document.body.appendChild(script);
}

/** The credential for the signed-in driver; null when this server has no MasterBox key; throws when it cannot be had. */
async function credential(): Promise<string | null> {
  if (notConfigured) return null;
  const { token } = await api<{ token: string | null }>('GET', '/support/masterbox-credential');
  if (!token) notConfigured = true;
  return token;
}

/**
 * Makes the widget the signed-in driver's (or the visitor's), loading it when a driver signs in. 'none': nobody is
 * signed in, or this server has no MasterBox key (the driver chats as a visitor); 'failed': no credential now.
 */
async function follow(userId: string | null): Promise<'ok' | 'none' | 'failed'> {
  if (!userId) {
    // Signed out: their conversation must not stay on this browser for the next person.
    if (loaded && loadedFor !== null) {
      loadedFor = null;
      send('setToken', null);
    }
    return 'none';
  }
  if (loadedFor === userId) return 'ok';
  try {
    const token = await credential();
    if (session.user?.id !== userId) return 'failed';
    if (!token) return 'none';
    loadedFor = userId;
    if (loaded) send('setToken', token);
    else load(token);
    return 'ok';
  } catch {
    return 'failed';
  }
}

/** Called by the 客服 page: loads the widget if it is not yet, and puts the chat on screen. Returns what takes it off. */
export function showSupportChat(top: number): () => void {
  const block = document.getElementById(BLOCK_ID);
  if (!block) {
    supportChat.state = 'failed';
    return () => undefined;
  }
  if (!loaded) {
    supportChat.state = 'loading';
    // A signed-in driver opens their own conversation, never a visitor's in their place.
    void follow(session.user?.id ?? null).then((result) => {
      if (result === 'failed') supportChat.state = 'failed';
      else if (!loaded) load(null);
    });
  }
  block.style.setProperty('--support-chat-top', `${top}px`);
  block.classList.add('is-shown');
  block.removeAttribute('aria-hidden');
  tellWidget();
  return () => {
    block.classList.remove('is-shown');
    block.setAttribute('aria-hidden', 'true');
    tellWidget();
  };
}

/** The widget looks again at whether its block is on screen, and at its size, when the window is resized. */
function tellWidget() {
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

/** Wires the widget to the app: who is signed in and the red dot. */
export function startSupportChat() {
  send('on', 'ready', () => {
    ready = true;
    clearTimeout(readyTimer);
    // Not in our block (嵌入模式 off for us, or the block not found): it fell back to the corner chat.
    supportChat.state = document.querySelector(`#${BLOCK_ID} iframe`) ? 'ready' : 'failed';
    tellWidget();
  });
  send('on', 'unread', (count: number) => (unread.support = count));
  watch(
    () => session.user?.id ?? null,
    (id) => void follow(id),
    { immediate: true },
  );
}
