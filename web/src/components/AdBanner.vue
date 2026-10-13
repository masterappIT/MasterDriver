<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { t } from '../i18n';

/** Master Travel promotion in driver-facing places only; never on passenger pages. */
const props = defineProps<{ position: 'CLAIM_PAGE' | 'HOME' | 'MY_ORDERS' }>();
const ads = ref<{ id: string; title: string; body: string; imageUrl: string | null; clickUrl: string }[]>([]);

onMounted(async () => {
  try {
    ads.value = (await api<typeof ads.value>('GET', `/public/ads?position=${props.position}`)).slice(0, 1);
    if (ads.value.length) void api('POST', '/public/ads/impressions', { ids: ads.value.map((ad) => ad.id) }).catch(() => undefined);
  } catch {
    ads.value = [];
  }
});
</script>

<template>
  <a v-for="ad in ads" :key="ad.id" class="ad-banner" :href="ad.clickUrl" target="_blank" rel="noopener">
    <img v-if="ad.imageUrl" :src="ad.imageUrl" alt="" class="ad-banner__image" />
    <span class="ad-banner__text">
      <strong>{{ t(ad.title) }}</strong>
      <span v-if="ad.body">{{ t(ad.body) }}</span>
    </span>
    <span class="ad-banner__tag">{{ t('推廣') }}</span>
  </a>
</template>

<style scoped>
.ad-banner {
  display: flex;
  gap: var(--space-md);
  align-items: center;
  background: var(--color-tint);
  border-radius: var(--radius-card);
  padding: var(--space-md);
  color: var(--color-text);
  margin-bottom: var(--space-lg);
}
.ad-banner__image {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: var(--radius-input);
}
.ad-banner__text {
  display: flex;
  flex-direction: column;
  flex: 1;
  font-size: var(--font-label);
}
.ad-banner__tag {
  font-size: var(--font-caption);
  color: var(--color-text-muted);
}
</style>
