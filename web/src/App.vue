<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import TabBar from './components/TabBar.vue';
import { t } from './i18n';
import { loadSite, site } from './site';
import { toastState } from './toast';

const route = useRoute();
const announcement = ref<string | null>(null);

onMounted(async () => {
  await loadSite();
  announcement.value = site.settings?.announcement ?? null;
});
</script>

<template>
  <div v-if="announcement && route.meta.app" class="announcement">{{ t(announcement) }}</div>
  <RouterView :key="route.fullPath" />
  <TabBar v-if="route.meta.app && route.path !== '/app/new'" />
  <div v-if="toastState.visible" class="toast" role="status">{{ toastState.text }}</div>
</template>

<style scoped>
.announcement {
  background: #fff6e0;
  color: var(--color-label);
  padding: var(--space-sm) var(--space-lg);
  font-size: var(--font-label);
}
.toast {
  position: fixed;
  left: 50%;
  top: 40%;
  transform: translateX(-50%);
  max-width: 80vw;
  background: rgba(23, 35, 61, 0.88);
  color: var(--color-on-primary);
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-input);
  z-index: 50;
  text-align: center;
}
</style>
