<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, apiFetch, can } from '../api';
import { ask, notify } from '../feedback';
import { dateTime, PLATE_TYPE } from '../format';
import { incomingTracker, playAlert, readAlertSound, writeAlertSound } from '../support-alert';
import { supportUnread } from '../support-unread';

type Participant = 'USER' | 'GUEST';

interface InboxItem {
  id: string;
  participant: Participant;
  name: string | null;
  phone: string | null;
  waiting: boolean;
  /** Messages from them no staff member has opened yet. */
  unread: number;
  lastMessageAt: string | null;
  lastFromStaff: boolean;
  preview: string;
}

interface Inbox {
  items: InboxItem[];
  /** Still to be answered, read or not. */
  waiting: number;
  /** With something nobody has opened yet: what the red dots and numbers count. */
  unread: number;
  unreadBy: Record<Participant, number>;
  total: number;
}

interface Message {
  seq: number;
  id: string;
  fromStaff: boolean;
  staffName: string | null;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO';
  text: string;
  media: { id: string; mime: string; sizeBytes: number; available: boolean } | null;
  createdAt: string;
}

interface Thread {
  conversation: { id: string; participant: Participant; userId: string | null; name: string | null; phone: string | null; waiting: boolean; createdAt: string };
  messages: Message[];
  hasEarlier: boolean;
  uploads: { images: boolean; videos: boolean };
}

/** What 詳細資料 shows of a user, from the same API as the user's page. */
interface UserFacts {
  id: string;
  phone: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  profile: {
    name: string | null;
    hkPlate: string | null;
    macauPlate: string | null;
    mainlandPlate: string | null;
    plateType: string | null;
    vehicleType: string | null;
    color: string | null;
    hkMacauPhone: string | null;
    mainlandPhone: string | null;
  } | null;
}

interface UserMatch {
  id: string;
  phone: string;
  name: string | null;
  plates: string[];
  suspended: boolean;
}

/** Same as SUPPORT_* in shared/src/support.ts. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const POLL_MS = 5000;

const AUDIENCES: { key: '' | Participant; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'USER', label: '用戶' },
  { key: 'GUEST', label: '訪客' },
];

const route = useRoute();
const router = useRouter();
const filter = ref<'waiting' | 'all'>('waiting');
const audience = ref<'' | Participant>('');
const search = ref('');
const inbox = ref<Inbox>({ items: [], waiting: 0, unread: 0, unreadBy: { USER: 0, GUEST: 0 }, total: 0 });
const inboxLoaded = ref(false);
const inboxError = ref('');
const thread = ref<Thread | null>(null);
const threadError = ref('');
const draft = ref('');
const sending = ref(false);
const error = ref('');
const notice = ref('');
/** Media id → local object URL, or 'loading' / 'failed'. Pictures load by themselves, videos on click. */
const files = reactive<Record<string, string>>({});
const bottom = ref<HTMLElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
const currentId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''));
let poller: ReturnType<typeof setInterval> | undefined;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const who = (item: { participant: string; name: string | null; phone: string | null }) =>
  item.participant === 'GUEST' ? '訪客' : (item.name ?? '未填姓名');

function newMessageId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ alert

const sound = ref(readAlertSound());
const fresh = ref(0);
const track = incomingTracker();

function toggleSound() {
  sound.value = !sound.value;
  writeAlertSound(sound.value);
  // Clicking here also counts as the click browsers want before they play anything.
  if (sound.value) playAlert();
}

/** Chimes and says so when someone new is waiting, whatever the list on screen is showing. */
async function checkIncoming(shown: Inbox | null) {
  const waiting = shown ?? (await api<Inbox>('GET', '/support/conversations?filter=waiting'));
  const count = track(waiting.items, waiting.waiting);
  if (count === 0) return;
  fresh.value += count;
  if (sound.value) playAlert();
}

// ------------------------------------------------------------------ inbox

/** The tab title shows the unread count while the page is open in the background; the router resets it on each conversation. */
function showCountInTitle() {
  document.title = `${inbox.value.unread > 0 ? `(${inbox.value.unread}) ` : ''}客服｜MasterDriver 平台後台`;
}

async function loadInbox() {
  const query = new URLSearchParams({ filter: filter.value });
  if (audience.value) query.set('participant', audience.value);
  if (search.value.trim()) query.set('q', search.value.trim());
  try {
    inbox.value = await api<Inbox>('GET', `/support/conversations?${query}`);
    inboxError.value = '';
    inboxLoaded.value = true;
  } catch (e) {
    inboxError.value = (e as Error).message;
    return;
  }
  supportUnread.count = inbox.value.unread;
  showCountInTitle();
  // The unfiltered waiting list is what the alert watches; ask again only when the screen shows another list.
  const unfiltered = filter.value === 'waiting' && !audience.value && !search.value.trim();
  await checkIncoming(unfiltered ? inbox.value : null).catch(() => undefined);
}

const emptyText = computed(() => {
  if (search.value.trim()) return '沒有符合搜尋的對話。';
  const kind = audience.value === 'USER' ? '用戶的' : audience.value === 'GUEST' ? '訪客的' : '';
  return filter.value === 'waiting' ? `目前沒有${kind}待回覆對話。` : `還沒有${kind}對話。`;
});

function showAll() {
  filter.value = 'all';
}

// ------------------------------------------------------------------ thread

async function openFile(id: string) {
  if (files[id] && files[id] !== 'failed') return;
  files[id] = 'loading';
  try {
    files[id] = URL.createObjectURL(await (await apiFetch('GET', `/support/media/${id}`)).blob());
  } catch {
    files[id] = 'failed';
  }
}

function add(incoming: Message[]) {
  if (!thread.value) return false;
  const known = new Set(thread.value.messages.map((message) => message.seq));
  const added = incoming.filter((message) => !known.has(message.seq));
  if (added.length === 0) return false;
  thread.value.messages = [...thread.value.messages, ...added].sort((a, b) => a.seq - b.seq);
  for (const message of added) if (message.kind === 'IMAGE' && message.media?.available) void openFile(message.media.id);
  return true;
}

const toBottom = () => nextTick(() => bottom.value?.scrollIntoView({ block: 'end' }));

async function loadThread() {
  thread.value = null;
  draft.value = '';
  error.value = '';
  notice.value = '';
  threadError.value = '';
  if (!currentId.value) return;
  try {
    const loaded = await api<Thread>('GET', `/support/conversations/${currentId.value}`);
    thread.value = { ...loaded, messages: [] };
    add(loaded.messages);
    void toBottom();
    // Opening it read it: its red dot and the counts go now, not at the next poll.
    void loadInbox();
    if (details.value) void loadFacts();
  } catch (e) {
    threadError.value = (e as Error).message;
  }
}

async function refresh() {
  if (document.hidden) return;
  // The open conversation first: what arrives in it is read on screen, so the list after it has no dot for it.
  const open = thread.value;
  if (open) {
    try {
      const last = open.messages[open.messages.length - 1];
      const newer = await api<Thread>('GET', `/support/conversations/${open.conversation.id}${last ? `?after=${last.seq}` : ''}`);
      if (thread.value === open) {
        open.conversation = newer.conversation;
        if (add(newer.messages)) void toBottom();
      }
    } catch {
      /* the next poll tries again */
    }
  }
  await loadInbox();
}

async function loadEarlier() {
  const open = thread.value;
  const first = open?.messages[0];
  if (!open || !first) return;
  const earlier = await api<Thread>('GET', `/support/conversations/${open.conversation.id}?before=${first.seq}`);
  open.hasEarlier = earlier.hasEarlier;
  add(earlier.messages);
}

async function deliver(send: (id: string) => Promise<Message>, onDone?: () => void) {
  error.value = '';
  notice.value = '';
  sending.value = true;
  try {
    add([await send(newMessageId())]);
    if (thread.value) thread.value.conversation.waiting = false;
    onDone?.();
    void toBottom();
    void loadInbox();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}

function reply() {
  const text = draft.value.trim();
  const id = thread.value?.conversation.id;
  if (!text || !id || sending.value) return;
  void deliver(
    (clientMessageId) => api<Message>('POST', `/support/conversations/${id}/messages`, { text, clientMessageId }),
    () => (draft.value = ''),
  );
}

function picked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const id = thread.value?.conversation.id;
  input.value = '';
  if (!file || !id) return;
  const isVideo = file.type.startsWith('video/');
  if (file.size > (isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES)) {
    error.value = `檔案太大（${megabytes(file.size)}）：圖片上限 5 MB，影片上限 25 MB`;
    return;
  }
  void deliver(async (clientMessageId) => {
    const response = await apiFetch('POST', `/support/conversations/${id}/media?clientMessageId=${clientMessageId}`, {
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    });
    return (await response.json()) as Message;
  });
}

function onKey(event: KeyboardEvent) {
  // Enter sends, Shift+Enter makes a new line; not while choosing a character with an input method.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    reply();
  }
}

/**
 * 刪除對話 (超級管理員 only): every message, picture and video goes, and the user's 客服 page starts
 * empty. The audit trail keeps who deleted whose conversation.
 */
async function deleteConversation() {
  const open = thread.value;
  if (!open || sending.value) return;
  const confirmed = await ask({
    title: '刪除這段對話',
    text: `「${who(open.conversation)}」的所有訊息、圖片和影片都會刪除，對方的客服頁也會一起清空。刪除後無法復原。`,
    confirm: '刪除對話',
    danger: true,
  });
  if (confirmed === null) return;
  sending.value = true;
  try {
    await api('DELETE', `/support/conversations/${open.conversation.id}`);
    notify('已刪除對話');
    await router.push('/support');
    await loadInbox();
  } catch (e) {
    notify((e as Error).message, true);
  } finally {
    sending.value = false;
  }
}

/** 不用回覆: off the waiting list without a reply; a message newer than the last one on screen keeps it there. */
async function markHandled() {
  const open = thread.value;
  const last = open?.messages[open.messages.length - 1];
  if (!open || !last || sending.value) return;
  error.value = '';
  notice.value = '';
  sending.value = true;
  try {
    const result = await api<{ waiting: boolean }>('POST', `/support/conversations/${open.conversation.id}/handled`, { seq: last.seq });
    open.conversation.waiting = result.waiting;
    if (result.waiting) {
      notice.value = '對方剛傳來新訊息，請先看過再決定。';
      await refresh();
    } else {
      notice.value = '已移出待回覆。對方再傳訊息時會回到待回覆。';
      await loadInbox();
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}

// ------------------------------------------------------------------ 詳細資料

const details = ref(false);
const facts = ref<UserFacts | null>(null);
const factsError = ref('');

async function loadFacts() {
  const userId = thread.value?.conversation.userId;
  factsError.value = '';
  if (!userId) {
    facts.value = null;
    return;
  }
  if (facts.value?.id === userId) return;
  facts.value = null;
  try {
    facts.value = await api<UserFacts>('GET', `/users/${userId}`);
  } catch (e) {
    factsError.value = (e as Error).message;
  }
}

function toggleDetails() {
  details.value = !details.value;
  if (details.value) void loadFacts();
}

const plates = computed(() => {
  const profile = facts.value?.profile;
  if (!profile) return '—';
  return [profile.hkPlate, profile.macauPlate, profile.mainlandPlate].filter(Boolean).join(' / ') || '—';
});

const vehicle = computed(() => {
  const profile = facts.value?.profile;
  if (!profile) return '—';
  return [profile.vehicleType, profile.color, profile.plateType ? PLATE_TYPE[profile.plateType] : null].filter(Boolean).join(' · ') || '—';
});

// ------------------------------------------------------------------ 新對話

const composing = ref(false);
const lookup = ref('');
const matches = ref<UserMatch[] | null>(null);
const lookupError = ref('');
const looking = ref(false);
const lookupField = ref<HTMLInputElement | null>(null);

function openNew() {
  composing.value = true;
  lookup.value = '';
  matches.value = null;
  lookupError.value = '';
  void nextTick(() => lookupField.value?.focus());
}

async function findUsers() {
  const q = lookup.value.trim();
  if (!q || looking.value) return;
  looking.value = true;
  lookupError.value = '';
  try {
    matches.value = (await api<{ items: UserMatch[] }>('GET', `/users?${new URLSearchParams({ page: '1', q })}`)).items;
  } catch (e) {
    lookupError.value = (e as Error).message;
  } finally {
    looking.value = false;
  }
}

async function startWith(user: UserMatch) {
  looking.value = true;
  lookupError.value = '';
  try {
    const { id } = await api<{ id: string }>('POST', '/support/conversations', { userId: user.id });
    composing.value = false;
    await router.push(`/support/${id}`);
  } catch (e) {
    lookupError.value = (e as Error).message;
  } finally {
    looking.value = false;
  }
}

watch([filter, audience], () => void loadInbox());
watch(currentId, () => {
  void loadThread();
  void nextTick(showCountInTitle);
});

onMounted(async () => {
  await loadInbox();
  await loadThread();
  poller = setInterval(() => void refresh(), POLL_MS);
});
onBeforeUnmount(() => {
  clearInterval(poller);
  for (const url of Object.values(files)) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
});
</script>

<template>
  <div class="page-head">
    <div class="page-head__title">
      <h1>客服</h1>
      <span v-if="inbox.unread" class="tag tag--danger">{{ inbox.unread }} 個未讀</span>
      <span v-if="inbox.waiting" class="tag">{{ inbox.waiting }} 個待回覆</span>
    </div>
    <div class="row">
      <button class="button secondary" type="button" :aria-pressed="sound" title="停留在這一頁時，有新訊息就響" @click="toggleSound">
        提示音：{{ sound ? '開' : '關' }}
      </button>
      <button class="button" type="button" @click="openNew">新對話</button>
    </div>
  </div>
  <div v-if="fresh" class="notice warning support__fresh" role="status">
    有 {{ fresh }} 則新訊息等待回覆。
    <button class="button secondary" type="button" @click="(fresh = 0), (filter = 'waiting'), (audience = '')">看待回覆</button>
    <button class="button secondary" type="button" @click="fresh = 0">知道了</button>
  </div>

  <div class="support">
    <section class="card support__inbox" :class="{ 'support__inbox--behind': currentId }">
      <div class="tabs support__filters">
        <button :class="{ active: filter === 'waiting' }" type="button" @click="filter = 'waiting'">待回覆</button>
        <button :class="{ active: filter === 'all' }" type="button" @click="filter = 'all'">全部對話</button>
      </div>
      <div class="support__audience" role="group" aria-label="對象">
        <button
          v-for="item in AUDIENCES"
          :key="item.key"
          type="button"
          :class="{ active: audience === item.key }"
          :aria-pressed="audience === item.key"
          @click="audience = item.key"
        >
          {{ item.label }}
          <span v-if="(item.key ? inbox.unreadBy[item.key] : inbox.unread) > 0" class="support__count" aria-label="未讀">
            {{ item.key ? inbox.unreadBy[item.key] : inbox.unread }}
          </span>
        </button>
      </div>
      <form class="support__search" @submit.prevent="loadInbox">
        <input v-model="search" class="input" type="search" placeholder="搜尋姓名或手機號碼，按 Enter" />
      </form>
      <div v-if="inboxError" class="notice error">
        對話列表讀取失敗：{{ inboxError }}
        <button class="button secondary" type="button" @click="loadInbox">重試</button>
      </div>
      <p v-else-if="!inboxLoaded" class="muted">載入中…</p>
      <div v-else-if="inbox.items.length === 0" class="support__empty">
        <p class="muted">{{ emptyText }}</p>
        <button v-if="filter === 'waiting' && !search.trim()" class="button secondary" type="button" @click="showAll">查看全部對話</button>
      </div>
      <ul class="support__items">
        <li v-for="item in inbox.items" :key="item.id">
          <RouterLink :to="`/support/${item.id}`" class="support__item" :class="{ 'support__item--open': item.id === currentId }">
            <div class="support__item-top">
              <span class="support__kind" :class="{ 'support__kind--guest': item.participant === 'GUEST' }">{{ item.participant === 'GUEST' ? '訪客' : '用戶' }}</span>
              <strong>{{ who(item) }}</strong>
              <span class="hint support__time">{{ dateTime(item.lastMessageAt) }}</span>
            </div>
            <div class="support__item-bottom">
              <span class="support__preview" :class="{ 'support__preview--unread': item.unread > 0 }">{{ item.lastFromStaff ? '客服：' : '' }}{{ item.preview }}</span>
              <span v-if="item.unread > 0" class="support__count" :aria-label="`${item.unread} 則未讀`">{{ item.unread }}</span>
              <span v-else-if="item.waiting" class="support__pending">待回覆</span>
            </div>
            <div v-if="item.phone" class="hint">{{ item.phone }}</div>
          </RouterLink>
        </li>
      </ul>
      <p v-if="inbox.total > inbox.items.length" class="hint">只顯示前 {{ inbox.items.length }} 個，請用搜尋縮小範圍。</p>
    </section>

    <section v-if="thread" class="card support__thread">
      <header class="support__who">
        <a class="hint support__back" href="#" @click.prevent="router.push('/support')">返回對話列表</a>
        <div class="support__who-name">
          <span class="support__kind" :class="{ 'support__kind--guest': thread.conversation.participant === 'GUEST' }">
            {{ thread.conversation.participant === 'GUEST' ? '訪客' : '用戶' }}
          </span>
          <strong>{{ who(thread.conversation) }}</strong>
          <span class="muted">{{ thread.conversation.phone ?? '未登入，無法主動聯絡' }}</span>
          <span v-if="thread.conversation.waiting" class="tag">待回覆</span>
        </div>
        <div class="row support__who-actions">
          <button v-if="thread.conversation.waiting" class="button secondary" type="button" :disabled="sending" title="最後一則不需要回覆（例如道謝），移出待回覆" @click="markHandled">
            不用回覆
          </button>
          <button class="button secondary" type="button" :aria-expanded="details" @click="toggleDetails">{{ details ? '收起資料' : '詳細資料' }}</button>
          <button v-if="can.superAdmin()" class="button danger" type="button" :disabled="sending" @click="deleteConversation">刪除對話</button>
        </div>
      </header>

      <div v-if="details" class="support__facts">
        <template v-if="thread.conversation.userId">
          <div v-if="factsError" class="notice error">
            資料讀取失敗：{{ factsError }}
            <button class="button secondary" type="button" @click="loadFacts">重試</button>
          </div>
          <p v-else-if="!facts" class="muted">載入中…</p>
          <dl v-else class="facts">
            <div><dt>姓名</dt><dd>{{ facts.profile?.name ?? '未填' }}</dd></div>
            <div><dt>登入號碼</dt><dd>{{ facts.phone }}</dd></div>
            <div><dt>港澳號碼</dt><dd>{{ facts.profile?.hkMacauPhone ?? '—' }}</dd></div>
            <div><dt>內地號碼</dt><dd>{{ facts.profile?.mainlandPhone ?? '—' }}</dd></div>
            <div><dt>車牌</dt><dd>{{ plates }}</dd></div>
            <div><dt>車型</dt><dd>{{ vehicle }}</dd></div>
            <div>
              <dt>帳號狀態</dt>
              <dd>
                <span v-if="facts.suspendedAt" class="tag tag--danger">已停用</span>
                <template v-else>使用中</template>
              </dd>
            </div>
            <div><dt>註冊</dt><dd>{{ dateTime(facts.createdAt) }}</dd></div>
            <div><dt>帳戶 ID</dt><dd class="support__id">{{ facts.id }}</dd></div>
            <div><dt>對話 ID</dt><dd class="support__id">{{ thread.conversation.id }}</dd></div>
          </dl>
          <p v-if="facts?.suspendedAt" class="hint">{{ dateTime(facts.suspendedAt) }} 停用，原因：{{ facts.suspendedReason ?? '—' }}</p>
          <p class="hint">港澳與內地號碼由司機自己填寫，沒有經過簡訊驗證。<RouterLink :to="`/users/${thread.conversation.userId}`">打開用戶頁</RouterLink></p>
        </template>
        <template v-else>
          <dl class="facts">
            <div><dt>對象</dt><dd>未登入的訪客</dd></div>
            <div><dt>開始時間</dt><dd>{{ dateTime(thread.conversation.createdAt) }}</dd></div>
            <div><dt>對話 ID</dt><dd class="support__id">{{ thread.conversation.id }}</dd></div>
          </dl>
          <p class="hint">訪客沒有帳號，平台無法主動聯絡；需要跟進時，請對方在對話裡留下電話或微信。</p>
        </template>
      </div>

      <div v-if="error" class="notice error support__inline-notice">{{ error }}</div>
      <div v-else-if="notice" class="notice support__inline-notice">{{ notice }}</div>

      <div class="support__messages">
        <button v-if="thread.hasEarlier" class="button secondary support__earlier" type="button" @click="loadEarlier">載入更早的訊息</button>
        <p v-if="thread.messages.length === 0" class="muted">還沒有訊息，可以先打招呼。</p>
        <div v-for="message in thread.messages" :key="message.seq" class="support__message" :class="{ 'support__message--staff': message.fromStaff }">
          <div class="support__bubble">
            <template v-if="message.media">
              <p v-if="!message.media.available || files[message.media.id] === 'failed'" class="muted">
                {{ message.media.available ? '檔案載入失敗' : '檔案已過期' }}
                <a v-if="message.media.available" href="#" @click.prevent="openFile(message.media.id)">重試</a>
              </p>
              <template v-else-if="message.kind === 'IMAGE'">
                <a v-if="files[message.media.id]?.startsWith('blob:')" :href="files[message.media.id]" target="_blank" rel="noopener">
                  <img class="support__media" :src="files[message.media.id]" alt="圖片" />
                </a>
                <span v-else class="hint">圖片載入中…</span>
              </template>
              <template v-else>
                <video v-if="files[message.media.id]?.startsWith('blob:')" class="support__media" :src="files[message.media.id]" controls />
                <button v-else class="button secondary" type="button" :disabled="files[message.media.id] === 'loading'" @click="openFile(message.media.id)">
                  {{ files[message.media.id] === 'loading' ? '影片載入中…' : `播放影片（${megabytes(message.media.sizeBytes)}）` }}
                </button>
              </template>
            </template>
            <p v-if="message.text" class="support__text">{{ message.text }}</p>
          </div>
          <div class="hint">{{ message.fromStaff ? `${message.staffName ?? '客服'}・` : '' }}{{ dateTime(message.createdAt) }}</div>
        </div>
        <div ref="bottom" />
      </div>

      <form class="support__compose" @submit.prevent="reply">
        <button v-if="thread.uploads.images" class="button secondary" type="button" :disabled="sending" title="傳送圖片或影片" @click="picker?.click()">附件</button>
        <input ref="picker" class="support__picker" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" @change="picked" />
        <textarea v-model="draft" class="input support__input" rows="2" maxlength="2000" placeholder="輸入回覆（Enter 傳送，Shift+Enter 換行）" @keydown="onKey" />
        <button class="button" type="submit" :disabled="sending || !draft.trim()">{{ sending ? '傳送中' : '傳送' }}</button>
      </form>
      <p v-if="!thread.uploads.images" class="hint">尚未設定媒體儲存空間（SUPPORT_MEDIA_BUCKET），目前只能傳送文字。</p>
    </section>
    <section v-else-if="threadError" class="card support__thread">
      <a class="hint support__back" href="#" @click.prevent="router.push('/support')">返回對話列表</a>
      <div class="notice error">
        對話讀取失敗：{{ threadError }}
        <button class="button secondary" type="button" @click="loadThread">重試</button>
      </div>
    </section>
    <section v-else-if="!currentId" class="card support__thread support__thread--empty muted">
      選擇左邊的對話開始回覆；要主動聯絡用戶，按右上角「新對話」。
    </section>
  </div>

  <div v-if="composing" class="support__backdrop" @click.self="composing = false" @keydown.esc="composing = false">
    <div class="card support__dialog" role="dialog" aria-modal="true" aria-labelledby="support-new-title">
      <div class="support__dialog-head">
        <h2 id="support-new-title">新對話</h2>
        <button class="button secondary" type="button" @click="composing = false">關閉</button>
      </div>
      <p class="hint">找到用戶後開始對話；已經有對話的，會打開原來那一個。訪客沒有帳號，不能主動聯絡。</p>
      <form class="row support__lookup" @submit.prevent="findUsers">
        <input ref="lookupField" v-model="lookup" class="input" placeholder="手機號碼、姓名或名片頁連結" :disabled="looking" />
        <button class="button" type="submit" :disabled="looking || !lookup.trim()">{{ looking ? '查找中…' : '查找' }}</button>
      </form>
      <div v-if="lookupError" class="notice error">{{ lookupError }}</div>
      <p v-if="matches && matches.length === 0" class="muted">找不到符合的用戶。</p>
      <ul v-if="matches?.length" class="support__matches">
        <li v-for="user in matches" :key="user.id">
          <button type="button" :disabled="looking" @click="startWith(user)">
            <strong>{{ user.name ?? '未填姓名' }}</strong>
            <span class="muted">{{ user.phone }}</span>
            <span v-if="user.plates.length" class="hint">{{ user.plates.join(' / ') }}</span>
            <span v-if="user.suspended" class="tag tag--danger">已停用</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.support {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.support__inbox {
  width: 300px;
  flex-shrink: 0;
  padding: var(--space-md) var(--space-lg);
}
.support__search .input {
  width: 100%;
}
.support__filters,
.support__search {
  margin-bottom: var(--space-md);
}
.support__items {
  list-style: none;
  margin: 0 0 var(--space-md);
  padding: 0;
}
.support__item {
  display: block;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  color: var(--color-text);
}
/* A whole row is the link: it lights up, it does not underline. */
.support__item:hover {
  background: var(--color-field);
  text-decoration: none;
}
.support__item--open,
.support__item--open:hover {
  background: var(--color-tint);
}
.support__item-top,
.support__item-bottom {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.support__item-top strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.support__time {
  flex-shrink: 0;
  margin-left: auto;
}
/* 用戶 or 訪客, before the name. */
.support__kind {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  color: var(--status-assigned);
  background: var(--status-assigned-bg);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
}
.support__kind--guest {
  color: var(--color-label);
  background: var(--color-divider);
}
/* Read, but not answered yet: quiet, unlike the red unread count. */
.support__pending {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
}
.support__preview {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-secondary);
}
.support__preview--unread {
  color: var(--color-text);
  font-weight: 600;
}
.support__audience {
  display: flex;
  gap: 4px;
  margin-bottom: var(--space-md);
  padding: 3px;
  border-radius: var(--radius-input);
  background: var(--color-field);
}
.support__audience button {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 8px;
  border: 0;
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: none;
  font-size: var(--font-label);
  font-weight: 600;
}
.support__audience button.active {
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: 0 1px 3px rgba(39, 72, 111, 0.12);
}
.support__count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  color: #fff;
  background: var(--color-danger);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.support__empty {
  padding: var(--space-sm) 0 var(--space-md);
}
.support__empty p {
  margin: 0 0 var(--space-sm);
}
.support__fresh {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm) var(--space-md);
}
.support__fresh .button,
.notice .button {
  min-height: 30px;
  padding: 4px 12px;
}
.support__thread {
  flex: 1;
  min-width: 0;
  padding: var(--space-lg);
}
.support__who {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--color-border);
}
.support__who-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.support__who-actions .button {
  min-height: 34px;
  padding: 6px 12px;
}
.support__facts {
  padding: var(--space-md) 0;
  border-bottom: 1px solid var(--color-border);
}
.support__facts .hint {
  margin: var(--space-sm) 0 0;
}
.support__id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--font-caption);
}
.support__inline-notice {
  margin: var(--space-md) 0 0;
}
.support__back {
  display: none;
}
/* 新對話: over the page, closed by 關閉, Esc or a click outside. */
.support__backdrop {
  position: fixed;
  z-index: 40;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 10vh 16px 16px;
  background: rgb(15 23 42 / 36%);
}
.support__dialog {
  width: min(520px, 100%);
  max-height: 80vh;
  margin: 0;
  overflow-y: auto;
}
.support__dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.support__dialog-head h2 {
  margin: 0;
}
.support__lookup {
  flex-wrap: nowrap;
  margin: var(--space-md) 0;
}
.support__lookup .input {
  flex: 1;
  min-width: 0;
}
.support__matches {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.support__matches button {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--space-sm);
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-input);
  color: var(--color-text);
  background: var(--color-surface);
  text-align: left;
}
.support__matches button:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-tint);
}
/* As tall as the window allows, so a conversation is read without scrolling the page. */
.support__messages {
  height: max(320px, calc(100vh - 290px));
  overflow-y: auto;
  padding: var(--space-md) 0;
}
.support__earlier {
  display: block;
  margin: 0 auto var(--space-md);
}
.support__message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-bottom: var(--space-md);
}
.support__message--staff {
  align-items: flex-end;
}
.support__bubble {
  max-width: 70%;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-background);
}
.support__message--staff .support__bubble {
  background: var(--color-tint);
}
.support__text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.support__media {
  display: block;
  max-width: 100%;
  max-height: 360px;
  border-radius: var(--radius-input);
}
.support__compose {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-end;
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-border);
}
.support__picker {
  display: none;
}
.support__input {
  flex: 1;
  min-width: 0;
  resize: vertical;
}

@media (max-width: 900px) {
  .support {
    display: block;
  }
  .support__inbox {
    width: auto;
  }
  /* On a phone, one thing at a time: the list, or the open conversation. */
  .support__inbox--behind,
  .support__thread--empty {
    display: none;
  }
  .support__back {
    display: inline;
  }
}
</style>
