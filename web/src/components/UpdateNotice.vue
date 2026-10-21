<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, session } from '../api';
import { language, t } from '../i18n';
import AppIcon from './AppIcon.vue';

/**
 * 更新說明彈窗: the picture the platform put up in 一般設定, shown like an ad over the driver's
 * app, once per account. Closing it is remembered on the server, so another phone does not show
 * it again; a new picture is a new version and shows once more.
 */
interface Notice {
  version: number;
  images: { hant: string | null; hans: string | null };
}

const route = useRoute();
const notice = ref<Notice | null>(null);
const shown = ref(false);
let askedFor: string | null = null;

const image = computed(() => {
  const images = notice.value?.images;
  if (!images) return null;
  return language.value === 'zh-Hans' ? (images.hans ?? images.hant) : images.hant;
});

// Asked once for each signed-in driver, on the first page of the app they open.
watch(
  () => [session.user?.id ?? null, Boolean(session.profile), Boolean(route.meta.app)] as const,
  async ([userId, hasProfile, inApp]) => {
    if (!userId || !hasProfile || !inApp || askedFor === userId) return;
    askedFor = userId;
    try {
      notice.value = (await api<{ notice: Notice | null }>('GET', '/me/update-notice')).notice;
    } catch {
      notice.value = null;
    }
  },
  { immediate: true },
);

/** Shown once the picture has loaded, so a slow network never shows an empty box. */
function loaded() {
  shown.value = true;
}

async function close() {
  const version = notice.value?.version;
  shown.value = false;
  notice.value = null;
  if (!version) return;
  try {
    await api('POST', '/me/update-notice/seen', { version });
  } catch {
    /* it shows again next time, which is better than never */
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && shown.value) void close();
}
window.addEventListener('keydown', onKey);
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="image && route.meta.app" v-show="shown" class="update-notice" role="dialog" aria-modal="true" :aria-label="t('更新說明')">
    <img class="update-notice__image" :src="image" :alt="t('師傅幫更新說明')" @load="loaded" @error="notice = null" />
    <button class="update-notice__close" type="button" :aria-label="t('關閉')" @click="close">
      <AppIcon name="close" :size="22" />
    </button>
  </div>
</template>

<style scoped>
.update-notice {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xl);
  padding: var(--space-xl) var(--space-lg);
  background: rgba(10, 18, 32, 0.62);
}
.update-notice__image {
  display: block;
  width: min(320px, 100%);
  max-height: calc(100vh - 160px);
  object-fit: contain;
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.update-notice__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  background: transparent;
  color: #ffffff;
}
</style>
