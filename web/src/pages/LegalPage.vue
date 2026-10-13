<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';

/** 服務條款 or 私隱政策, as written in the platform admin (一般設定). */
const route = useRoute();
const kind = computed(() => (route.params.kind === 'privacy' ? 'privacy' : 'terms'));
const text = ref<string | null>(null);

onMounted(async () => {
  text.value = (await api<{ text: string }>('GET', `/public/${kind.value}`).catch(() => ({ text: '' }))).text;
});
</script>

<template>
  <div class="page">
    <PageBack :title="kind === 'privacy' ? t('私隱政策') : t('服務條款')" fallback="/" history />
    <p v-if="text === ''" class="muted">{{ t('暫未提供') }}</p>
    <div v-else-if="text" class="card legal__text">{{ t(text) }}</div>
  </div>
</template>

<style scoped>
.legal__text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
