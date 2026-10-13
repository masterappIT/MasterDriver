<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
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

async function load() {
  error.value = '';
  try {
    orders.value = await api<OrderSummary[]>('GET', `/orders?role=${tab.value}`);
  } catch (e) {
    error.value = errorText(e);
  }
}

watch(tab, (value) => {
  void router.replace({ query: { tab: value } });
  void load();
});
onMounted(load);
</script>

<template>
  <div class="page">
    <h1>{{ t('我的單') }}</h1>
    <div class="orders-page__tabs">
      <button class="orders-page__tab" :class="{ active: tab === 'claimed' }" type="button" @click="tab = 'claimed'">{{ t('接的單') }}</button>
      <button class="orders-page__tab" :class="{ active: tab === 'dispatched' }" type="button" @click="tab = 'dispatched'">{{ t('派的單') }}</button>
    </div>
    <div v-if="error" class="notice error">{{ error }}</div>
    <OrderCard v-for="order in orders" :key="order.code" :order="order" :role="tab" />
    <p v-if="orders.length === 0" class="card muted">{{ tab === 'claimed' ? t('還沒有接過單。') : t('還沒有發過單。') }}</p>
    <AdBanner position="MY_ORDERS" />
  </div>
</template>

<style scoped>
.orders-page__tabs {
  display: flex;
  background: var(--color-surface);
  border-radius: var(--radius-pill);
  padding: var(--space-xs);
  margin-bottom: var(--space-lg);
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
  background: var(--color-tint);
  color: var(--color-nav-active);
}
</style>
