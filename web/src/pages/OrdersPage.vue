<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import AdBanner from '../components/AdBanner.vue';
import OrderCard, { type OrderSummary } from '../components/OrderCard.vue';
import { t } from '../i18n';

const route = useRoute();
const router = useRouter();
const tab = ref<'claimed' | 'dispatched'>(route.query.tab === 'dispatched' ? 'dispatched' : 'claimed');
const orders = ref<OrderSummary[]>([]);
const error = ref('');
const loaded = ref(false);

/** Which orders to show; in progress first, since that is what the driver acts on. */
type Phase = 'live' | 'done' | 'cancelled' | 'unpaid' | 'unsettled';
const PHASES: { value: Phase; label: string; statuses: string[]; dispatchedOnly?: boolean }[] = [
  { value: 'live', label: '進行中', statuses: ['OPEN', 'ASSIGNED'] },
  { value: 'done', label: '已完成', statuses: ['COMPLETED'] },
  { value: 'cancelled', label: '已取消', statuses: ['CANCELLED'] },
  // 收款: orders the dispatcher has a driver for (or finished) but has not marked as paid.
  { value: 'unpaid', label: '未收款', statuses: ['ASSIGNED', 'COMPLETED'], dispatchedOnly: true },
  // 已結清: finished orders whose account between dispatcher and driver is not marked settled; both sides.
  { value: 'unsettled', label: '未結清', statuses: ['COMPLETED'] },
];
const phases = computed(() => PHASES.filter((item) => !item.dispatchedOnly || tab.value === 'dispatched'));
const phase = ref<Phase>('live');
const shown = computed(() => {
  const statuses = PHASES.find((item) => item.value === phase.value)?.statuses ?? [];
  return listed.value.filter(
    (order) =>
      statuses.includes(order.status) &&
      (phase.value !== 'unpaid' || !order.paidAt) &&
      (phase.value !== 'unsettled' || (!order.settledAt && !order.selfDrive)),
  );
});

/** 接駁: the legs of one trip stay together, in leg order, where the trip's first listed leg appears. */
const listed = computed(() => {
  const trips = new Map<string, OrderSummary[]>();
  const result: (OrderSummary | OrderSummary[])[] = [];
  for (const order of orders.value) {
    const trip = order.journey?.legs[0]?.id;
    if (!trip) {
      result.push(order);
      continue;
    }
    const legs = trips.get(trip);
    if (legs) legs.push(order);
    else {
      const group = [order];
      trips.set(trip, group);
      result.push(group);
    }
  }
  return result.flatMap((entry) =>
    Array.isArray(entry) ? [...entry].sort((a, b) => (a.journey?.legIndex ?? 0) - (b.journey?.legIndex ?? 0)) : [entry],
  );
});

async function load() {
  error.value = '';
  try {
    orders.value = await api<OrderSummary[]>('GET', `/orders?role=${tab.value}`);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
}

/** Back on the page (another tab, or from the order itself): show it as it is now. */
function onVisible() {
  if (document.visibilityState === 'visible') void load();
}

watch(tab, (value) => {
  if (value === 'claimed' && phase.value === 'unpaid') phase.value = 'live';
  void router.replace({ query: { tab: value } });
  void load();
});
onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));
</script>

<template>
  <div class="page">
    <h1>{{ t('訂單') }}</h1>
    <div class="orders-page__tabs" role="tablist">
      <button class="orders-page__tab" :class="{ active: tab === 'claimed' }" type="button" role="tab" :aria-selected="tab === 'claimed'" @click="tab = 'claimed'">{{ t('我接的') }}</button>
      <button class="orders-page__tab" :class="{ active: tab === 'dispatched' }" type="button" role="tab" :aria-selected="tab === 'dispatched'" @click="tab = 'dispatched'">{{ t('我出的') }}</button>
    </div>
    <div class="chips orders-page__phases">
      <button
        v-for="item in phases"
        :key="item.value"
        class="chip"
        :class="{ 'chip--on': phase === item.value }"
        type="button"
        :aria-pressed="phase === item.value"
        @click="phase = item.value"
      >
        {{ t(item.label) }}
      </button>
    </div>
    <div v-if="error" class="notice error">{{ error }}</div>
    <OrderCard v-for="order in shown" :key="order.code" :order="order" :role="tab" />
    <p v-if="loaded && !error && shown.length === 0" class="card muted">
      <template v-if="orders.length === 0">{{ tab === 'claimed' ? t('還沒有接過單。在群裡看到單，點連結就能搶。') : t('還沒有出過單。按下面的「出單」開始。') }}</template>
      <template v-else>{{ t(`沒有${PHASES.find((item) => item.value === phase)?.label}的單。`) }}</template>
    </p>
    <AdBanner position="MY_ORDERS" />
  </div>
</template>

<style scoped>
.orders-page__tabs {
  display: flex;
  background: var(--color-card);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-pill);
  padding: var(--space-xs);
  margin-bottom: var(--space-md);
}
.orders-page__tab {
  flex: 1;
  border: none;
  background: none;
  border-radius: var(--radius-pill);
  min-height: 40px;
  font: inherit;
  font-weight: 600;
  color: var(--color-nav-inactive);
  cursor: pointer;
}
.orders-page__tab.active {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.orders-page__phases {
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}
</style>
