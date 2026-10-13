<script setup lang="ts">
import { money, pickup } from '../format';
import { t } from '../i18n';
import StatusBadge from './StatusBadge.vue';

export interface OrderSummary {
  id?: string;
  code: string;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  driverPrice: { amount: number; currency: string } | null;
  passengerConfirmedAt: string | null;
  dispatcherName: string | null;
  driver?: { name: string | null } | null;
}

defineProps<{ order: OrderSummary; role: 'dispatched' | 'claimed' }>();
</script>

<template>
  <RouterLink :to="`/app/orders/${order.id}`" class="card order-card">
    <div class="order-card__top">
      <strong>{{ pickup(order.pickupAt) }}</strong>
      <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
    </div>
    <div class="order-card__route">{{ t(order.origin) }} → {{ t(order.destination) }}</div>
    <div class="muted">
      {{ t(`${order.passengers}人・${order.luggage}件行李`) }}<template v-if="order.vehicleType">・{{ t(order.vehicleType) }}</template>
      <template v-if="order.driverPrice">・{{ money(order.driverPrice) }}</template>
    </div>
    <div class="hint">
      <template v-if="role === 'dispatched'">{{ order.driver?.name ? t(`司機：${order.driver.name}`) : t('等待司機搶單') }}</template>
      <template v-else>{{ t(`派單：${order.dispatcherName ?? '—'}`) }}</template>
    </div>
  </RouterLink>
</template>

<style scoped>
.order-card {
  display: block;
  color: var(--color-text);
}
.order-card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.order-card__route {
  font-size: var(--font-body-large);
  font-weight: 600;
  margin: var(--space-xs) 0;
}
</style>
