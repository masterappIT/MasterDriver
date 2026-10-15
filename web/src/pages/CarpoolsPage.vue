<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import { carpoolLabel, carpoolTone, type DriverCarpool } from '../carpool';
import PageBack from '../components/PageBack.vue';
import TonePill from '../components/TonePill.vue';
import { money, pickup } from '../format';
import { t } from '../i18n';

/** 我開的拼車: newest trip first, each with how its seats stand. */
const carpools = ref<DriverCarpool[] | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    carpools.value = await api<DriverCarpool[]>('GET', '/carpools');
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('拼車')" fallback="/app/me" />
    <div v-if="error" class="notice error">{{ error }}</div>
    <RouterLink class="button block large carpools__new" to="/app/carpools/new">{{ t('開拼車') }}</RouterLink>
    <p v-if="carpools && carpools.length === 0" class="carpools__empty">
      {{ t('還沒有拼車。開一趟拼車，把連結發給乘客，他們就可以在上面報位；湊夠了你自己開，或派到群裡給別的司機。') }}
    </p>
    <RouterLink v-for="carpool in carpools ?? []" :key="carpool.id" :to="`/app/carpools/${carpool.id}`" class="card carpools__item">
      <div class="carpools__top">
        <strong class="carpools__time">{{ pickup(carpool.pickupAt) }}</strong>
        <TonePill :tone="carpoolTone(carpool)" :dot="carpool.unread">{{ t(carpoolLabel(carpool)) }}</TonePill>
      </div>
      <div class="carpools__route">{{ t(`${carpool.origin} 至 ${carpool.destination}`) }}</div>
      <div class="carpools__meta">
        <span>{{ t(`已確認 ${carpool.confirmed} 位｜剩 ${carpool.left} 位`) }}</span>
        <span v-if="carpool.waiting" class="carpools__waiting">{{ t(`${carpool.waiting} 個報位等你確認`) }}</span>
        <span v-else-if="carpool.seatPrice">{{ t(`每位 ${money(carpool.seatPrice)}`) }}</span>
      </div>
    </RouterLink>
  </div>
</template>

<style scoped>
.carpools__new {
  margin-bottom: var(--space-lg);
}
.carpools__empty {
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.carpools__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--color-text);
}
.carpools__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}
.carpools__time {
  font-variant-numeric: tabular-nums;
}
.carpools__route {
  font-size: var(--font-body-large);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.carpools__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.carpools__waiting {
  color: var(--color-gold-ink);
  font-weight: 700;
}
</style>
