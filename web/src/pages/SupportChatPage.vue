<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { session } from '../api';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { showSupportChat, supportChat } from '../masterbox';

/**
 * 客服 (2026-11-19): our own page, header and 返回 as before; below them, MasterBox's chat (masterbox.ts), which is
 * not part of this page but put on screen over the rest of it while the page is open.
 */
const top = ref<HTMLElement | null>(null);
let hide: (() => void) | null = null;

const bottomOfTop = () => Math.round(top.value?.getBoundingClientRect().bottom ?? 0);
function moved() {
  document.getElementById('support-chat')?.style.setProperty('--support-chat-top', `${bottomOfTop()}px`);
}

onMounted(() => {
  hide = showSupportChat(bottomOfTop());
  window.addEventListener('resize', moved);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', moved);
  hide?.();
});
</script>

<template>
  <div class="page support-chat">
    <div ref="top" class="support-chat__top">
      <PageBack :title="t('客服')" :fallback="session.user ? '/app/me' : '/'" history />
      <p v-if="!session.user" class="notice">
        {{ t('你尚未登入。訪客對話只保存在這個瀏覽器，清除瀏覽資料後無法找回；請在訊息裡留下電話或微信，方便我們回覆。') }}
      </p>
    </div>
    <p v-if="supportChat.state === 'failed'" class="notice error">{{ t('客服暫時打不開，請檢查網路後再試') }}</p>
    <p v-else-if="supportChat.state !== 'ready'" class="muted">{{ t('客服載入中…') }}</p>
  </div>
</template>

<style scoped>
.support-chat__top {
  padding-bottom: var(--space-sm);
}
.support-chat__top :deep(.page-back) {
  margin-bottom: var(--space-sm);
}
.support-chat__top .notice {
  margin: 0;
}
</style>
