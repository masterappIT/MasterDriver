<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { session } from '../api';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { showSupportChat, supportChat } from '../masterbox';

/**
 * 客服 (2026-11-19): our own page; below its header, room for MasterBox's chat (masterbox.ts), which is not part of
 * this page but lies over that room and scrolls with the page.
 *
 * The chat's own page never passes a swipe on to ours (its html is overflow hidden, overscroll-behavior none), so a
 * chat filling the screen would leave no way back up to 返回. The 返回 bar therefore stays at the top, and the room is
 * one screen high less the bar: what is between them (a visitor's notice) scrolls away under the bar, a swipe on the
 * bar brings it back, and the chat then fills the rest of the screen. In the chat, its messages scroll.
 */
const page = ref<HTMLElement | null>(null);
const bar = ref<HTMLElement | null>(null);
const room = ref<HTMLElement | null>(null);
let hide: (() => void) | null = null;
let barWatcher: ResizeObserver | null = null;

onMounted(() => {
  if (bar.value && page.value) {
    const target = page.value;
    barWatcher = new ResizeObserver(([entry]) =>
      target.style.setProperty('--support-bar-height', `${Math.round(entry.target.getBoundingClientRect().height)}px`),
    );
    barWatcher.observe(bar.value);
  }
  if (room.value) hide = showSupportChat(room.value);
});
onBeforeUnmount(() => {
  barWatcher?.disconnect();
  hide?.();
});
</script>

<template>
  <div ref="page" class="page support-chat">
    <div ref="bar" class="support-chat__bar">
      <PageBack :title="t('客服')" :fallback="session.user ? '/app/me' : '/'" history />
    </div>
    <div class="support-chat__top">
      <p v-if="!session.user" class="notice">
        {{ t('你尚未登入。訪客對話只保存在這個瀏覽器，清除瀏覽資料後無法找回；請在訊息裡留下電話或微信，方便我們回覆。') }}
      </p>
      <p v-if="supportChat.state === 'failed'" class="notice error">{{ t('客服暫時打不開，請檢查網路後再試') }}</p>
      <p v-else-if="supportChat.state !== 'ready'" class="muted">{{ t('客服載入中…') }}</p>
    </div>
    <div ref="room" class="support-chat__room" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
/* No room kept for the tab bar: this page has none, and the chat reaches the bottom of the screen. */
.support-chat {
  padding-bottom: 0;
}
/* Held at the top, over the chat (#support-chat is z-index 5) as it scrolls up. The page's own top padding is the
   bar's, so the bar is the same height stuck or not; the top of the page is plain background, so it shows no seam. */
.support-chat__bar {
  position: sticky;
  top: 0;
  z-index: 6;
  margin: calc(-1 * var(--space-lg)) calc(-1 * var(--space-lg)) 0;
  padding: var(--space-lg) var(--space-lg) var(--space-sm);
  background: var(--color-background);
}
.support-chat__bar :deep(.page-back) {
  margin-bottom: 0;
}
.support-chat__top p {
  margin: 0 0 var(--space-sm);
}
.support-chat__room {
  height: calc(100vh - var(--support-bar-height, 0px));
  height: calc(100dvh - var(--support-bar-height, 0px));
}
</style>
