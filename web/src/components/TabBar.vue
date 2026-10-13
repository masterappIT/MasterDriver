<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '../i18n';
import { refreshUnread, unread } from '../unread';
import AppIcon, { type IconName } from './AppIcon.vue';

const route = useRoute();

interface Tab {
  to: string;
  label: string;
  icon: IconName;
  match: (path: string) => boolean;
}
const LEFT: Tab[] = [
  { to: '/app', label: '首頁', icon: 'home', match: (path) => path === '/app' },
  { to: '/app/pool', label: '接單池', icon: 'list', match: (path) => path.startsWith('/app/pool') },
];
const RIGHT: Tab[] = [
  { to: '/app/orders', label: '訂單', icon: 'orders', match: (path) => path.startsWith('/app/orders') },
  { to: '/app/me', label: '我的', icon: 'person', match: (path) => path.startsWith('/app/me') || path.startsWith('/app/bookings') || path.startsWith('/app/profile-page') },
];
/** New bookings and 客服 replies both live under 我的. */
const meCount = computed(() => unread.bookings + unread.support);

// Fresh numbers whenever the driver moves between pages; no polling in the background.
watch(() => route.path, () => void refreshUnread(), { immediate: true });
</script>

<template>
  <!-- A floating capsule of frosted glass, with 出單 raised in the middle as the most frequent action. -->
  <nav class="tab-bar" :aria-label="t('主選單')">
    <RouterLink
      v-for="tab in LEFT"
      :key="tab.to"
      :to="tab.to"
      class="tab-bar__item"
      :class="{ active: tab.match(route.path) }"
      :aria-current="tab.match(route.path) ? 'page' : undefined"
    >
      <AppIcon :name="tab.icon" :size="22" />
      <span>{{ t(tab.label) }}</span>
    </RouterLink>

    <RouterLink to="/app/new" class="tab-bar__new" :aria-label="t('出單')">
      <span class="tab-bar__new-disc"><AppIcon name="add" :size="26" /></span>
      <span>{{ t('出單') }}</span>
    </RouterLink>

    <RouterLink
      v-for="tab in RIGHT"
      :key="tab.to"
      :to="tab.to"
      class="tab-bar__item"
      :class="{ active: tab.match(route.path) }"
      :aria-current="tab.match(route.path) ? 'page' : undefined"
    >
      <span class="tab-bar__icon">
        <AppIcon :name="tab.icon" :size="22" />
        <span v-if="tab.to === '/app/me' && meCount" class="tab-bar__count" :aria-label="t(`${meCount} 項未讀`)">{{ meCount > 99 ? '99+' : meCount }}</span>
      </span>
      <span>{{ t(tab.label) }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tab-bar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--tab-offset) + var(--safe-bottom));
  transform: translateX(-50%);
  width: calc(min(100vw, var(--max-width)) - var(--space-lg) * 2);
  height: var(--tab-height);
  padding: 6px;
  display: flex;
  align-items: stretch;
  gap: 2px;
  border: 1px solid var(--color-glass-border);
  border-radius: var(--radius-pill);
  background: var(--color-glass);
  -webkit-backdrop-filter: blur(var(--blur-glass)) saturate(180%);
  backdrop-filter: blur(var(--blur-glass)) saturate(180%);
  box-shadow: var(--shadow-floating);
  z-index: 20;
}
/* Browsers without backdrop blur (some older Android WebViews) get a near-solid capsule so labels stay readable. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tab-bar {
    background: var(--color-glass-fallback);
  }
}
.tab-bar__item,
.tab-bar__new {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: var(--radius-pill);
  color: var(--color-nav-inactive);
  font-size: 11px;
  line-height: 1.2;
}
.tab-bar__item.active {
  background: var(--color-glass-active);
  color: var(--color-nav-active);
  font-weight: 600;
}
.tab-bar__icon {
  position: relative;
}
.tab-bar__count {
  position: absolute;
  top: -5px;
  left: 14px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--color-error);
  color: var(--color-on-primary);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}
/* 出單: a solid disc lifted above the capsule. */
.tab-bar__new {
  justify-content: flex-end;
  color: var(--color-primary);
  font-weight: 700;
}
.tab-bar__new-disc {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-top: -22px;
  border: 3px solid var(--color-surface);
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
  box-shadow: 0 6px 16px rgba(31, 95, 214, 0.35);
}
</style>
