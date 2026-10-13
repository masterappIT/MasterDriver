<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { errorText, session } from '../api';
import { shortTime } from '../format';
import PageBack from '../components/PageBack.vue';
import AppIcon from '../components/AppIcon.vue';
import { t } from '../i18n';
import {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  imageForSupport,
  loadThread,
  mediaUrl,
  megabytes,
  newMessageId,
  sendFile,
  sendText,
  type SupportMessage,
} from '../support';
import { toast } from '../toast';

const POLL_MS = 5000;
const messages = ref<SupportMessage[]>([]);
const hasEarlier = ref(false);
const uploads = ref({ images: true, videos: false });
const draft = ref('');
const sending = ref(false);
const error = ref('');
const loaded = ref(false);
/** Media id → local object URL, or 'loading' / 'failed'. Pictures load by themselves, videos on tap. */
const files = reactive<Record<string, string>>({});
const bottom = ref<HTMLElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
let poller: ReturnType<typeof setInterval> | undefined;

function add(incoming: SupportMessage[]) {
  const known = new Set(messages.value.map((message) => message.seq));
  const fresh = incoming.filter((message) => !known.has(message.seq));
  if (fresh.length === 0) return false;
  messages.value = [...messages.value, ...fresh].sort((a, b) => a.seq - b.seq);
  for (const message of fresh) if (message.kind === 'IMAGE' && message.media?.available) void open(message.media.id);
  return true;
}

async function open(id: string) {
  if (files[id] && files[id] !== 'failed') return;
  files[id] = 'loading';
  try {
    files[id] = await mediaUrl(id);
  } catch {
    files[id] = 'failed';
  }
}

const toBottom = () => nextTick(() => bottom.value?.scrollIntoView({ block: 'end' }));

async function refresh() {
  if (document.hidden) return;
  try {
    const last = messages.value[messages.value.length - 1];
    const thread = await loadThread(last ? { after: last.seq } : {});
    if (!last) hasEarlier.value = thread.hasEarlier;
    uploads.value = thread.uploads;
    if (add(thread.messages)) void toBottom();
  } catch {
    /* the next poll tries again */
  }
}

async function loadEarlier() {
  const first = messages.value[0];
  if (!first) return;
  try {
    const thread = await loadThread({ before: first.seq });
    hasEarlier.value = thread.hasEarlier;
    add(thread.messages);
  } catch (e) {
    error.value = errorText(e);
  }
}

/** Runs a send; on failure the same id is used again on retry, so nothing is posted twice. */
async function deliver(send: (id: string) => Promise<SupportMessage>, onDone?: () => void) {
  error.value = '';
  sending.value = true;
  const id = newMessageId();
  try {
    let message: SupportMessage;
    try {
      message = await send(id);
    } catch (first) {
      // One quiet retry covers a dropped connection; anything else is shown.
      if (first instanceof Error && first.name === 'TypeError') message = await send(id);
      else throw first;
    }
    add([message]);
    onDone?.();
    void toBottom();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    sending.value = false;
  }
}

function submit() {
  const text = draft.value.trim();
  if (!text || sending.value) return;
  void deliver(
    (id) => sendText(text, id),
    () => (draft.value = ''),
  );
}

async function picked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.type.startsWith('video/')) {
    if (!uploads.value.videos) return toast('登入後才能傳送影片');
    if (file.size > VIDEO_MAX_BYTES) return toast(`影片太大（${megabytes(file.size)}），上限 25 MB，請剪短後再傳`);
    return deliver((id) => sendFile(file, id));
  }
  let image: Blob;
  try {
    image = await imageForSupport(file);
  } catch {
    return toast('這張圖片無法讀取，請改傳截圖或 JPG');
  }
  if (image.size > IMAGE_MAX_BYTES) return toast('圖片太大，上限 5 MB');
  return deliver((id) => sendFile(image, id));
}

onMounted(async () => {
  try {
    const thread = await loadThread();
    hasEarlier.value = thread.hasEarlier;
    uploads.value = thread.uploads;
    add(thread.messages);
  } catch (e) {
    error.value = errorText(e);
  }
  loaded.value = true;
  void toBottom();
  poller = setInterval(() => void refresh(), POLL_MS);
});
onBeforeUnmount(() => {
  clearInterval(poller);
  for (const url of Object.values(files)) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
});
</script>

<template>
  <div class="page support">
    <PageBack :title="t('客服')" :fallback="session.user ? '/app/me' : '/'" history />

    <p v-if="!session.user" class="notice">
      {{ t('你尚未登入。訪客對話只保存在這個瀏覽器，清除瀏覽資料後無法找回；請在訊息裡留下電話或微信，方便我們回覆。') }}
    </p>

    <button v-if="hasEarlier" class="chip support__earlier" type="button" @click="loadEarlier">{{ t('載入更早的訊息') }}</button>
    <p v-if="loaded && messages.length === 0" class="muted support__empty">{{ t('有什麼可以幫你？可以傳文字、圖片或影片，我們會盡快回覆。') }}</p>

    <ol class="support__list">
      <li v-for="message in messages" :key="message.seq" class="support__item" :class="{ 'support__item--mine': !message.fromStaff }">
        <div class="support__bubble">
          <template v-if="message.media">
            <p v-if="!message.media.available || files[message.media.id] === 'failed'" class="support__gone">
              {{ message.media.available ? t('檔案載入失敗') : t('檔案已過期') }}
              <button v-if="message.media.available" class="chip" type="button" @click="open(message.media.id)">{{ t('重試') }}</button>
            </p>
            <template v-else-if="message.kind === 'IMAGE'">
              <a v-if="files[message.media.id]?.startsWith('blob:')" :href="files[message.media.id]" target="_blank" rel="noopener">
                <img class="support__image" :src="files[message.media.id]" :alt="t('圖片')" />
              </a>
              <span v-else class="hint">{{ t('圖片載入中…') }}</span>
            </template>
            <template v-else>
              <video v-if="files[message.media.id]?.startsWith('blob:')" class="support__video" :src="files[message.media.id]" controls playsinline />
              <button v-else class="button secondary" type="button" :disabled="files[message.media.id] === 'loading'" @click="open(message.media.id)">
                {{ files[message.media.id] === 'loading' ? t('影片載入中…') : t(`播放影片（${megabytes(message.media.sizeBytes)}）`) }}
              </button>
            </template>
          </template>
          <p v-if="message.text" class="support__text">{{ message.text }}</p>
        </div>
        <span class="hint">{{ message.fromStaff ? t('客服') + '・' : '' }}{{ shortTime(message.createdAt) }}</span>
      </li>
    </ol>
    <div ref="bottom" />

    <form class="action-bar support__bar" @submit.prevent="submit">
      <div v-if="error" class="notice error support__error">{{ error }}</div>
      <div class="support__compose">
        <button v-if="uploads.images" class="button secondary support__attach" type="button" :disabled="sending" :aria-label="t('傳送圖片或影片')" @click="picker?.click()"><AppIcon name="add" /></button>
        <input ref="picker" class="support__picker" type="file" :accept="uploads.videos ? 'image/*,video/*' : 'image/*'" @change="picked" />
        <textarea v-model="draft" class="textarea support__input" rows="1" maxlength="2000" :placeholder="t('輸入訊息')" />
        <button class="button" type="submit" :disabled="sending || !draft.trim()">{{ sending ? t('傳送中') : t('傳送') }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.support {
  padding-bottom: calc(120px + var(--safe-bottom));
}
.support__earlier {
  display: block;
  margin: 0 auto var(--space-md);
}
.support__empty {
  text-align: center;
  margin-top: var(--space-xl);
}
.support__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.support__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-bottom: var(--space-md);
}
.support__item--mine {
  align-items: flex-end;
}
.support__bubble {
  max-width: 82%;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.support__item--mine .support__bubble {
  background: var(--color-tint);
  box-shadow: none;
}
.support__text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.support__image,
.support__video {
  display: block;
  max-width: 100%;
  max-height: 320px;
  border-radius: var(--radius-input);
}
.support__gone {
  margin: 0;
  color: var(--color-text-muted);
}
.support__error {
  margin-bottom: var(--space-sm);
}
.support__compose {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-end;
}
.support__attach {
  flex-shrink: 0;
  width: 44px;
  padding: 0;
}
.support__picker {
  display: none;
}
/* The message box is a capsule, like a chat app's, not a form field. */
.support__input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  max-height: 120px;
  padding: 10px var(--space-lg);
  border-color: var(--color-card-border);
  border-radius: 22px;
  resize: none;
}
</style>
