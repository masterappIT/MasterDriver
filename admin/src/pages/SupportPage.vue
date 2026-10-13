<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, apiFetch } from '../api';
import { dateTime } from '../format';

interface InboxItem {
  id: string;
  participant: 'USER' | 'GUEST';
  name: string | null;
  phone: string | null;
  waiting: boolean;
  lastMessageAt: string | null;
  lastFromStaff: boolean;
  preview: string;
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
  conversation: { id: string; participant: 'USER' | 'GUEST'; userId: string | null; name: string | null; phone: string | null; waiting: boolean; createdAt: string };
  messages: Message[];
  hasEarlier: boolean;
  uploads: { images: boolean; videos: boolean };
}

/** Same as SUPPORT_* in shared/src/support.ts. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const POLL_MS = 5000;

const route = useRoute();
const router = useRouter();
const filter = ref<'waiting' | 'all'>('waiting');
const search = ref('');
const inbox = ref<{ items: InboxItem[]; waiting: number; total: number }>({ items: [], waiting: 0, total: 0 });
const thread = ref<Thread | null>(null);
const draft = ref('');
const sending = ref(false);
const error = ref('');
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

async function loadInbox() {
  const query = new URLSearchParams({ filter: filter.value, ...(search.value.trim() ? { q: search.value.trim() } : {}) });
  inbox.value = await api('GET', `/support/conversations?${query}`);
  // The tab title shows the count while the page is open in the background.
  document.title = `${inbox.value.waiting > 0 ? `(${inbox.value.waiting}) ` : ''}客服｜MasterDriver 平台後台`;
}

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
  const fresh = incoming.filter((message) => !known.has(message.seq));
  if (fresh.length === 0) return false;
  thread.value.messages = [...thread.value.messages, ...fresh].sort((a, b) => a.seq - b.seq);
  for (const message of fresh) if (message.kind === 'IMAGE' && message.media?.available) void openFile(message.media.id);
  return true;
}

const toBottom = () => nextTick(() => bottom.value?.scrollIntoView({ block: 'end' }));

async function loadThread() {
  thread.value = null;
  draft.value = '';
  error.value = '';
  if (!currentId.value) return;
  try {
    const loaded = await api<Thread>('GET', `/support/conversations/${currentId.value}`);
    thread.value = { ...loaded, messages: [] };
    add(loaded.messages);
    void toBottom();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function refresh() {
  if (document.hidden) return;
  try {
    await loadInbox();
    const open = thread.value;
    if (!open) return;
    const last = open.messages[open.messages.length - 1];
    const newer = await api<Thread>('GET', `/support/conversations/${open.conversation.id}${last ? `?after=${last.seq}` : ''}`);
    if (thread.value !== open) return;
    open.conversation = newer.conversation;
    if (add(newer.messages)) void toBottom();
  } catch {
    /* the next poll tries again */
  }
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
  sending.value = true;
  try {
    add([await send(newMessageId())]);
    onDone?.();
    void toBottom();
    void loadInbox().catch(() => undefined);
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

watch([filter], () => void loadInbox().catch((e) => (error.value = (e as Error).message)));
watch(currentId, () => void loadThread());

onMounted(async () => {
  try {
    await loadInbox();
  } catch (e) {
    error.value = (e as Error).message;
  }
  await loadThread();
  poller = setInterval(() => void refresh(), POLL_MS);
});
onBeforeUnmount(() => {
  clearInterval(poller);
  for (const url of Object.values(files)) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
});
</script>

<template>
  <h1>客服 <span v-if="inbox.waiting" class="support__count">{{ inbox.waiting }} 個待回覆</span></h1>
  <div v-if="error" class="notice error">{{ error }}</div>

  <div class="support">
    <section class="card support__inbox" :class="{ 'support__inbox--behind': currentId }">
      <div class="row support__filters">
        <button class="button" :class="{ secondary: filter !== 'waiting' }" type="button" @click="filter = 'waiting'">待回覆</button>
        <button class="button" :class="{ secondary: filter !== 'all' }" type="button" @click="filter = 'all'">全部</button>
      </div>
      <form class="support__search" @submit.prevent="loadInbox">
        <input v-model="search" class="input" placeholder="搜尋姓名或手機號碼" />
      </form>
      <p v-if="inbox.items.length === 0" class="muted">{{ filter === 'waiting' ? '沒有等待回覆的對話。' : '還沒有對話。' }}</p>
      <ul class="support__items">
        <li v-for="item in inbox.items" :key="item.id">
          <RouterLink :to="`/support/${item.id}`" class="support__item" :class="{ 'support__item--open': item.id === currentId }">
            <div class="support__item-top">
              <strong>{{ who(item) }}</strong>
              <span v-if="item.waiting" class="support__dot">待回覆</span>
            </div>
            <div class="hint">{{ item.phone ?? '未登入' }}・{{ dateTime(item.lastMessageAt) }}</div>
            <div class="support__preview">{{ item.lastFromStaff ? '客服：' : '' }}{{ item.preview }}</div>
          </RouterLink>
        </li>
      </ul>
      <p v-if="inbox.total > inbox.items.length" class="hint">只顯示前 {{ inbox.items.length }} 個，請用搜尋縮小範圍。</p>
      <p class="hint">主動聯繫：到「用戶」找到對象，按「用客服聯絡這位用戶」。</p>
    </section>

    <section v-if="thread" class="card support__thread">
      <header class="support__who">
        <a class="hint support__back" href="#" @click.prevent="router.push('/support')">← 對話列表</a>
        <div>
          <strong>{{ who(thread.conversation) }}</strong>
          <span class="muted">　{{ thread.conversation.phone ?? '未登入的訪客，無法主動聯絡，請請對方留下電話或微信' }}</span>
        </div>
        <RouterLink v-if="thread.conversation.userId" :to="`/users/${thread.conversation.userId}`" class="hint">查看用戶 →</RouterLink>
      </header>

      <div class="support__messages">
        <button v-if="thread.hasEarlier" class="button secondary support__earlier" type="button" @click="loadEarlier">載入更早的訊息</button>
        <p v-if="thread.messages.length === 0" class="muted">還沒有訊息。</p>
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
                  ▶ {{ files[message.media.id] === 'loading' ? '影片載入中…' : `播放影片（${megabytes(message.media.sizeBytes)}）` }}
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
        <button v-if="thread.uploads.images" class="button secondary" type="button" :disabled="sending" title="傳送圖片或影片" @click="picker?.click()">＋</button>
        <input ref="picker" class="support__picker" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" @change="picked" />
        <textarea v-model="draft" class="input support__input" rows="2" maxlength="2000" placeholder="輸入回覆（Enter 傳送，Shift+Enter 換行）" @keydown="onKey" />
        <button class="button" type="submit" :disabled="sending || !draft.trim()">{{ sending ? '傳送中' : '傳送' }}</button>
      </form>
      <p v-if="!thread.uploads.images" class="hint">尚未設定媒體儲存空間（SUPPORT_MEDIA_BUCKET），目前只能傳送文字。</p>
    </section>
    <section v-else-if="!currentId" class="card support__thread support__thread--empty muted">選擇左邊的對話開始回覆。</section>
  </div>
</template>

<style scoped>
.support {
  display: flex;
  gap: var(--space-lg);
  align-items: flex-start;
}
.support__count {
  font-size: var(--font-body);
  font-weight: 400;
  color: var(--color-danger);
}
.support__inbox {
  width: 320px;
  flex-shrink: 0;
  padding: var(--space-lg);
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
.support__item--open {
  background: var(--color-tint);
}
.support__item-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.support__dot {
  color: var(--color-danger);
  font-size: var(--font-caption);
}
.support__preview {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-secondary);
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
.support__back {
  display: none;
}
.support__messages {
  height: 56vh;
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
