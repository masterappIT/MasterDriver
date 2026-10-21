<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import { DEAL_STATE, dealTime, type DriverDeal } from '../deal';
import PageBack from '../components/PageBack.vue';
import TonePill from '../components/TonePill.vue';
import { money } from '../format';
import { t } from '../i18n';

/** 我的特價車: newest first, each with how its bookings stand. */
const deals = ref<DriverDeal[] | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    deals.value = await api<DriverDeal[]>('GET', '/deals');
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('特價車')" fallback="/app/me" />
    <div v-if="error" class="notice error">{{ error }}</div>
    <RouterLink class="button block large deals__new" to="/app/deals/new">{{ t('發特價車') }}</RouterLink>
    <p v-if="deals && deals.length === 0" class="deals__empty">
      {{ t('還沒有特價車。定好路線、時段和每組的價錢，把連結或分享圖發給乘客；多少組客人都可以預約，每組各成一張單，你自己做或派到群裡。') }}
    </p>
    <RouterLink v-for="deal in deals ?? []" :key="deal.id" :to="`/app/deals/${deal.id}`" class="card deals__item">
      <div class="deals__top">
        <strong class="deals__time">{{ t(dealTime(deal)) }}</strong>
        <TonePill :tone="DEAL_STATE[deal.state].tone" :dot="deal.unread">{{ t(DEAL_STATE[deal.state].driver) }}</TonePill>
      </div>
      <div class="deals__route">{{ t(`${deal.origin} 至 ${deal.destination}`) }}</div>
      <div class="deals__meta">
        <span>{{ t(`包車 ${money(deal.price)}`) }}</span>
        <span v-if="deal.waiting + deal.toOrder && deal.state !== 'CANCELLED'" class="deals__waiting">{{ t(`${deal.waiting + deal.toOrder} 組等你處理`) }}</span>
        <span v-else-if="deal.bookings.length">{{ t(`${deal.bookings.length} 組預約｜${deal.ordered} 張已成單`) }}</span>
      </div>
    </RouterLink>
  </div>
</template>

<style scoped>
.deals__new {
  margin-bottom: var(--space-lg);
}
.deals__empty {
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.deals__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--color-text);
}
.deals__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}
.deals__time {
  font-variant-numeric: tabular-nums;
}
.deals__route {
  font-size: var(--font-body-large);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.deals__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.deals__waiting {
  color: var(--color-gold-ink);
  font-weight: 700;
}
</style>
