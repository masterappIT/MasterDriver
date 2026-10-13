<script setup lang="ts">
import { useRoute } from 'vue-router';
import { t } from '../i18n';

const route = useRoute();
const TABS = [
  { to: '/app', label: '首頁', match: (path: string) => path === '/app' || path === '/app/new' },
  { to: '/app/orders', label: '我的單', match: (path: string) => path.startsWith('/app/orders') },
  { to: '/app/me', label: '我的', match: (path: string) => path.startsWith('/app/me') },
];
</script>

<template>
  <nav class="tab-bar">
    <RouterLink v-for="tab in TABS" :key="tab.to" :to="tab.to" class="tab-bar__item" :class="{ active: tab.match(route.path) }">
      {{ t(tab.label) }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.tab-bar {
  position: fixed;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: 100%;
  max-width: var(--max-width);
  height: calc(var(--tab-height) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  display: flex;
  background: var(--color-surface);
  border-top: 1px solid var(--color-divider);
  z-index: 20;
}
.tab-bar__item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-nav-inactive);
  font-weight: 600;
}
.tab-bar__item.active {
  color: var(--color-nav-active);
}
</style>
