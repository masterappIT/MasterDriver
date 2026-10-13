<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorText, session } from '../api';
import AdBanner from '../components/AdBanner.vue';
import OrderCard, { type OrderSummary } from '../components/OrderCard.vue';
import { money } from '../format';
import { t } from '../i18n';

type Listed = OrderSummary & { viewer: 'dispatcher' | 'driver' };

const dispatched = ref<Listed[]>([]);
const claimed = ref<Listed[]>([]);
const fee = ref<{ enabled: boolean; feePerOrder: { amount: number; currency: string }; exempt: boolean } | null>(null);
const balance = ref<{ amount: number; currency: string } | null>(null);
const error = ref('');

const active = (orders: Listed[]) =>
  orders.filter((order) => order.status === 'OPEN' || order.status === 'ASSIGNED').sort((a, b) => a.pickupAt.localeCompare(b.pickupAt));
const upcoming = computed(() => [...active(dispatched.value), ...active(claimed.value)].sort((a, b) => a.pickupAt.localeCompare(b.pickupAt)));

onMounted(async () => {
  try {
    const [sent, taken, credits] = await Promise.all([
      api<Listed[]>('GET', '/orders?role=dispatched'),
      api<Listed[]>('GET', '/orders?role=claimed'),
      api<{ balance: { amount: number; currency: string }; serviceFee: NonNullable<typeof fee.value> }>('GET', '/me/credits'),
    ]);
    dispatched.value = sent;
    claimed.value = taken;
    fee.value = credits.serviceFee;
    balance.value = credits.balance;
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page">
    <h1>{{ t(`你好，${session.profile?.name ?? '師傅'}`) }}</h1>
    <div v-if="error" class="notice error">{{ error }}</div>

    <RouterLink to="/app/new" class="button block large home-page__new">＋ {{ t('發單') }}</RouterLink>
    <p v-if="fee?.enabled && !fee.exempt" class="hint">
      {{ t(`每發一張單扣 ${money(fee.feePerOrder)} 點數，取消會退回。目前餘額 ${money(balance)}。`) }}
    </p>

    <h2>{{ t('進行中') }}</h2>
    <OrderCard
      v-for="order in upcoming"
      :key="order.code"
      :order="order"
      :role="order.viewer === 'dispatcher' ? 'dispatched' : 'claimed'"
    />
    <p v-if="upcoming.length === 0" class="card muted">{{ t('目前沒有進行中的單。在群裡看到單，點連結就能搶。') }}</p>

    <AdBanner position="HOME" />
  </div>
</template>

<style scoped>
.home-page__new {
  margin-bottom: var(--space-sm);
}
h2 {
  margin-top: var(--space-xl);
}
</style>
