<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { t } from '../i18n';

/** 服務條款 or 私隱政策, as written in the platform admin (一般設定). */
const route = useRoute();
const router = useRouter();
const kind = computed(() => (route.params.kind === 'privacy' ? 'privacy' : 'terms'));
const text = ref<string | null>(null);

onMounted(async () => {
  text.value = (await api<{ text: string }>('GET', `/public/${kind.value}`).catch(() => ({ text: '' }))).text;
});
</script>

<template>
  <div class="page">
    <a class="hint" href="#" @click.prevent="router.back()">← {{ t('返回') }}</a>
    <h1>{{ kind === 'privacy' ? t('私隱政策') : t('服務條款') }}</h1>
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
