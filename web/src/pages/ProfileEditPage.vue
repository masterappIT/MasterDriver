<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { session } from '../api';
import PageBack from '../components/PageBack.vue';
import ProfileForm from '../components/ProfileForm.vue';
import { t } from '../i18n';
import { toast } from '../toast';

/**
 * 司機資料 on a page of its own: the form is long (plates, two numbers, the car), and a sheet
 * over another page does not hold its place in every browser. `next` is where the driver was
 * sent from to fill it in (an order they were about to take); otherwise it sits under 我的.
 */
const route = useRoute();
const router = useRouter();
// Only a path inside the tool: never follow an address someone put in the link.
const next = computed(() => {
  const asked = route.query.next;
  return typeof asked === 'string' && /^\/(app|o)\/[\w/-]*$/.test(asked) ? asked : null;
});
const upTo = computed(() => next.value ?? '/app/me');

async function saved() {
  toast(next.value ? '已儲存，可以繼續搶單' : '已儲存');
  await router.replace(upTo.value);
}
</script>

<template>
  <div class="page">
    <PageBack :title="session.profile ? t('司機資料') : t('填寫司機資料')" :fallback="upTo" />
    <ProfileForm @saved="saved" />
  </div>
</template>
