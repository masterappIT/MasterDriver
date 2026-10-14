<script setup lang="ts">
import { computed } from 'vue';
import { loadLine, money, pickup } from '../format';
import { t } from '../i18n';
import { legLabel, plateRequirement, type Journey, type PlateRegion } from '../journey';
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
  /** 收款 (dispatcher only): when the fare was marked received. */
  paidAt?: string | null;
  /** 已結清: when the dispatcher marked the account with the driver as settled. */
  settledAt?: string | null;
  /** 接駁: the order this leg belongs to. */
  journey?: Journey | null;
}

/** `pool`: an order in the 接單池, which opens its claim page instead of the order's own page. */
const props = defineProps<{ order: OrderSummary; role: 'dispatched' | 'claimed' | 'pool' }>();

/** "4人｜3件行李｜7座", the same line as in the group text. */
const load = computed(() => loadLine(props.order.passengers, props.order.luggage, props.order.vehicleType));

/**
 * 接駁 shown as one order (the dispatcher's list and the 接單池): the whole route and each leg in a
 * word. A driver's own list shows the leg they took instead.
 */
const whole = computed(() => (props.role !== 'claimed' ? (props.order.journey ?? null) : null));
const status = computed(() => whole.value?.status ?? props.order.status);
function legState(leg: Journey['legs'][number]) {
  if (leg.status === 'CANCELLED') return '已取消';
  if (leg.status === 'COMPLETED') return '已完成';
  if (leg.selfDrive) return props.role === 'dispatched' ? '你自己開' : '出單者自己開';
  if (leg.status === 'OPEN') return props.role === 'pool' ? '可搶' : '等司機搶';
  return leg.driver?.name ? `${leg.driver.name} 接了` : '已有司機';
}
</script>

<template>
  <RouterLink :to="role === 'pool' ? `/o/${order.code}` : `/app/orders/${order.id}`" class="card order-card">
    <div class="order-card__top">
      <strong class="order-card__time">{{ pickup(order.pickupAt) }}</strong>
      <span v-if="role === 'pool' && order.driverPrice && !whole" class="order-card__price">{{ money(order.driverPrice) }}</span>
      <StatusBadge v-else-if="role !== 'pool'" :status="status" :confirmed="Boolean(order.passengerConfirmedAt)" />
    </div>
    <div class="order-card__route">{{ whole ? t(`${whole.origin} 至 ${whole.destination}`) : t(`${order.origin} 至 ${order.destination}`) }}</div>
    <div class="order-card__meta">
      <span>{{ t(load) }}</span>
      <span v-if="!whole && order.requiredPlates?.length" class="gold-tag">{{ t(plateRequirement(order.requiredPlates)) }}</span>
      <span v-if="whole" class="leg-tag">{{ t('接駁（中途換車）') }}</span>
      <span v-else-if="order.journey" class="leg-tag">{{ t(`接駁 ${legLabel(order.journey)}`) }}</span>
      <span v-if="role === 'dispatched' && status === 'COMPLETED' && !order.paidAt" class="gold-tag">{{ t('未收款') }}</span>
      <span v-if="!whole && order.status === 'COMPLETED' && !order.settledAt && !order.selfDrive" class="gold-tag">{{ t('未結清') }}</span>
    </div>
    <!-- 接駁: one line per leg, so the card says which leg still needs a driver. -->
    <ul v-if="whole" class="order-card__legs">
      <li v-for="leg in whole.legs" :key="leg.legIndex">
        <span>{{ t(`第 ${leg.legIndex} 段`) }}</span>
        <span>{{ t(legState(leg)) }}</span>
        <span v-if="role === 'pool' && leg.driverPrice && leg.status === 'OPEN'" class="order-card__foot-price">{{ money(leg.driverPrice) }}</span>
      </li>
    </ul>
    <div v-if="!(whole && role === 'dispatched')" class="order-card__foot">
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
.order-card__legs {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-label);
  color: var(--color-text-secondary);
}
.order-card__legs li {
  display: flex;
  gap: var(--space-sm);
}
.order-card__legs .order-card__foot-price {
  margin-left: auto;
}
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
