<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

/**
 * Back from a detail page to where it was opened: the order list with its filters, a user's page
 * with its tab, or 客服. Opened directly (a link, a new tab), it goes to the list it belongs to.
 */
const props = defineProps<{ to: string; label: string }>();
const router = useRouter();

const PLACES: [string, string][] = [
  ['/orders/', '返回訂單'],
  ['/orders', '返回訂單'],
  ['/users/', '返回用戶'],
  ['/users', '返回用戶'],
  ['/support', '返回客服'],
  ['/leads', '返回潛在客戶'],
  ['/audit', '返回操作紀錄'],
  ['/', '返回總覽'],
];

const previous = computed(() => (window.history.state as { back?: string | null } | null)?.back ?? null);
/** Where the browser's back goes, when that is a page of this admin that names itself. */
const place = computed(() => {
  const back = previous.value;
  if (!back || back.startsWith('/login')) return null;
  return PLACES.find(([prefix]) => (prefix === '/' ? back === '/' : back.startsWith(prefix)))?.[1] ?? null;
});

/** One navigation per click: back through history, or the link's own, never both. */
function go(event: MouseEvent, navigate: (event: MouseEvent) => unknown) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || !place.value) {
    void navigate(event);
    return;
  }
  event.preventDefault();
  router.back();
}
</script>

<template>
  <RouterLink v-slot="{ href, navigate }" :to="to" custom>
    <a :href="href" class="back-link" @click="go($event, navigate)">{{ place ?? label }}</a>
  </RouterLink>
</template>
