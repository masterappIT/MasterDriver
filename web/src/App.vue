<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TabBar from './components/TabBar.vue';
import { session } from './api';
import { unlockOnFirstTouch } from './alert-sound';
import { t } from './i18n';
import { closeBanner, describe, inbox, markRead, startNotifications, stopNotifications } from './notifications';
import { loadSite, site } from './site';
import { toastState } from './toast';
import { COPYRIGHT } from './copyright';

const route = useRoute();
const router = useRouter();
const announcement = ref<string | null>(null);

onMounted(async () => {
  unlockOnFirstTouch();
  await loadSite();
  announcement.value = site.settings?.announcement ?? null;
});

// Notifications arrive on every page while someone is signed in, and stop for whoever signs out.
watch(
  () => session.user?.id ?? null,
  (id, previous) => {
    if (previous) stopNotifications();
    if (id) startNotifications();
  },
  { immediate: true },
);

const banner = computed(() => (inbox.banner ? describe(inbox.banner) : null));

async function openBanner() {
  const item = inbox.banner;
  closeBanner();
  if (!item) return;
  void markRead(item);
  const to = describe(item).to;
  await router.push(inbox.bannerMore > 0 || !to ? '/app/notifications' : to);
}
</script>

<template>
  <div v-if="announcement && route.meta.app" class="announcement">{{ t(announcement) }}</div>
  <RouterView :key="route.fullPath" />
  <!-- The home page ends with its own copyright line. -->
  <footer v-if="route.path !== '/'" class="copyright" :class="{ 'copyright--app': route.meta.app && route.path !== '/app/new' }">{{ t(COPYRIGHT) }}</footer>
  <TabBar v-if="route.meta.app && route.path !== '/app/new'" />
  <div v-if="banner" class="notice-banner" role="status">
    <button type="button" class="notice-banner__body" @click="openBanner">
      <strong>{{ t(banner.title) }}</strong>
      <span v-if="inbox.bannerMore > 0">{{ t(`還有 ${inbox.bannerMore} 則新通知`) }}</span>
      <span v-else-if="banner.detail">{{ t(banner.detail) }}</span>
    </button>
    <button type="button" class="notice-banner__close" :aria-label="t('關閉')" @click="closeBanner">{{ t('關閉') }}</button>
  </div>
  <div v-if="toastState.visible" class="toast" role="status">{{ toastState.text }}</div>
</template>

<style scoped>
/* Every page ends with it. Pages of the tool keep room at the bottom for the tab bar; the line
   moves up into that room so it sits under the content, not behind the bar. */
.copyright {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: var(--space-md) var(--space-lg) calc(var(--space-lg) + var(--safe-bottom));
  color: var(--color-text-muted);
  font-size: var(--font-caption);
  text-align: center;
}
.copyright--app {
  margin-top: calc(-1 * (var(--tab-height) + var(--tab-offset) + var(--space-xl) + var(--safe-bottom)));
  padding-bottom: calc(var(--tab-height) + var(--tab-offset) + var(--space-lg) + var(--safe-bottom));
}
.announcement {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  padding: var(--space-sm) var(--space-lg);
  font-size: var(--font-label);
  text-align: center;
}
.toast {
  position: fixed;
  left: 50%;
  top: 40%;
  transform: translateX(-50%);
  max-width: 80vw;
  background: rgba(20, 32, 51, 0.9);
  color: var(--color-on-primary);
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-input);
  z-index: 50;
  text-align: center;
}
/* A new notification slides in at the top; tapping it opens what it is about. */
.notice-banner {
  position: fixed;
  top: calc(var(--space-sm) + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  width: calc(min(100vw, var(--max-width)) - var(--space-lg) * 2);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-lg);
  border: 1px solid var(--color-glass-border);
  border-radius: var(--radius-input);
  background: var(--color-surface);
  box-shadow: var(--shadow-floating);
  z-index: 60;
  animation: notice-in 0.25s ease-out;
}
.notice-banner__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-xs) 0;
  border: none;
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.notice-banner__body span {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notice-banner__close {
  flex-shrink: 0;
  min-height: 36px;
  padding: 0 var(--space-md);
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font: inherit;
  font-size: var(--font-caption);
  cursor: pointer;
}
@keyframes notice-in {
  from {
    opacity: 0;
    transform: translate(-50%, -12px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .notice-banner {
    animation: none;
  }
}
</style>
