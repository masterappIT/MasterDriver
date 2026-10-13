<script setup lang="ts">
import { computed } from 'vue';
import { money, pickup } from '../format';
import { t } from '../i18n';
import { legLabel, plateRequirement, type PlateRegion } from '../journey';
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
  selfDrive?: boolean;
  requiredPlates?: PlateRegion[];
  /** 接駁: the trip this order is a leg of; legs[0].id (dispatcher only) identifies it. */
  journey?: { legIndex: number; legCount: number; legs: { id?: string }[] } | null;
}

/** `pool`: an order in the 接單池, which opens its claim page instead of the order's own page. */
const props = defineProps<{ order: OrderSummary; role: 'dispatched' | 'claimed' | 'pool' }>();

/** "4人｜3件行李｜7座", the same line as in the group text. */
const load = computed(() => [`${props.order.passengers}人`, `${props.order.luggage}件行李`, props.order.vehicleType].filter(Boolean).join('｜'));
</script>

<template>
  <RouterLink :to="role === 'pool' ? `/o/${order.code}` : `/app/orders/${order.id}`" class="card order-card">
    <div class="order-card__top">
      <strong class="order-card__time">{{ pickup(order.pickupAt) }}</strong>
      <span v-if="role === 'pool' && order.driverPrice" class="order-card__price">{{ money(order.driverPrice) }}</span>
      <StatusBadge v-else-if="role !== 'pool'" :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
    </div>
    <div class="order-card__route">{{ t(`${order.origin} 至 ${order.destination}`) }}</div>
    <div class="order-card__meta">
      <span>{{ t(load) }}</span>
      <span v-if="order.requiredPlates?.length" class="gold-tag">{{ t(plateRequirement(order.requiredPlates)) }}</span>
      <span v-if="order.journey" class="leg-tag">{{ t(`接駁 ${legLabel(order.journey)}`) }}</span>
    </div>
    <div class="order-card__foot">
      <template v-if="role === 'dispatched'">
        {{ order.selfDrive && order.status === 'ASSIGNED' ? t('你自己做') : order.driver?.name ? t(`${order.driver.name} 接了`) : t('等司機搶') }}
        <span v-if="order.driverPrice" class="order-card__foot-price">{{ money(order.driverPrice) }}</span>
      </template>
      <template v-else>
        {{ order.dispatcherName ? t(`${order.dispatcherName} 出的單`) : t('出單者沒有留名') }}
        <span v-if="role === 'claimed' && order.driverPrice" class="order-card__foot-price">{{ money(order.driverPrice) }}</span>
      </template>
    </div>
  </RouterLink>
</template>

<style scoped>
.order-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--color-text);
  margin-bottom: var(--space-md);
}
.order-card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}
.order-card__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.order-card__price {
  color: var(--color-gold-ink);
  font-size: var(--font-body-large);
  font-weight: 700;
  white-space: nowrap;
}
.order-card__route {
  font-size: var(--font-body-large);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.order-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
  color: var(--color-label);
  font-size: var(--font-label);
}
.order-card__foot {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--color-divider);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.order-card__foot-price {
  color: var(--color-gold-ink);
  font-weight: 700;
}
</style>
