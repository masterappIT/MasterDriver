<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, errorText, session } from '../api';
import AdBanner from '../components/AdBanner.vue';
import { type OrderSummary } from '../components/OrderCard.vue';
import { money, pickup, shortTime } from '../format';
import { t } from '../i18n';
import { timeUntil } from '../relative-time';
import { refreshUnread, unread } from '../unread';

type Listed = OrderSummary & {
  viewer: 'dispatcher' | 'driver';
  passengerContact?: string | null;
  contactRevealAt?: string | null;
};

/**
 * 首頁: today's information, not a second order list. Only what needs the driver now:
 * things waiting, quick ways to dispatch, the trips they drive today and tomorrow,
 * how their own orders stand, and what is in the 接單池. Every order lives in 訂單.
 */
const dispatched = ref<Listed[]>([]);
const claimed = ref<Listed[]>([]);
const pool = ref<OrderSummary[] | null>(null);
const fee = ref<{ enabled: boolean; feePerOrder: { amount: number; currency: string }; exempt: boolean } | null>(null);
const balance = ref<{ amount: number; currency: string } | null>(null);
const error = ref('');
const loaded = ref(false);
const now = ref(new Date());
let clock: ReturnType<typeof setInterval> | undefined;

const live = (order: Listed) => order.status === 'OPEN' || order.status === 'ASSIGNED';

/** The end of tomorrow in Hong Kong (UTC+8), where these trips run. */
const endOfTomorrow = computed(() => {
  const local = new Date(now.value.getTime() + 8 * 60 * 60 * 1000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 2) - 8 * 60 * 60 * 1000;
});

/** Trips this driver drives: ones they claimed, and legs they kept for themselves (這段我自己做). */
const myTrips = computed(() =>
  [...claimed.value, ...dispatched.value.filter((order) => order.selfDrive)]
    .filter((order) => order.status === 'ASSIGNED' && new Date(order.pickupAt).getTime() <= endOfTomorrow.value)
    .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt)),
);

/** How the orders they put out stand: waiting for a driver, taken, confirmed by the passenger. */
const sent = computed(() => {
  const mine = dispatched.value.filter((order) => live(order) && !order.selfDrive);
  return {
    open: mine.filter((order) => order.status === 'OPEN').length,
    taken: mine.filter((order) => order.status === 'ASSIGNED' && !order.passengerConfirmedAt).length,
    confirmed: mine.filter((order) => order.status === 'ASSIGNED' && order.passengerConfirmedAt).length,
  };
});
const sentTotal = computed(() => sent.value.open + sent.value.taken + sent.value.confirmed);
const waiting = computed(() => unread.bookings + unread.support);

/** "今天 10/14（二）" under the greeting. */
const today = computed(() => pickup(now.value.toISOString()).replace(/\s?\d{2}:\d{2}$/, ''));

onMounted(async () => {
  clock = setInterval(() => (now.value = new Date()), 30_000);
  void refreshUnread();
  if (session.profile) {
    void api<OrderSummary[]>('GET', '/orders/pool')
      .then((orders) => (pool.value = orders))
      .catch(() => (pool.value = null));
  }
  try {
    const [sentOrders, takenOrders, credits] = await Promise.all([
      api<Listed[]>('GET', '/orders?role=dispatched'),
      api<Listed[]>('GET', '/orders?role=claimed'),
      api<{ balance: { amount: number; currency: string }; serviceFee: NonNullable<typeof fee.value> }>('GET', '/me/credits'),
    ]);
    dispatched.value = sentOrders;
    claimed.value = takenOrders;
    fee.value = credits.serviceFee;
    balance.value = credits.balance;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
});
onBeforeUnmount(() => clearInterval(clock));
</script>

<template>
  <div class="page home">
    <header class="home__hello">
      <h1>{{ t(`你好，${session.profile?.name ?? '師傅'}`) }}</h1>
      <span>{{ today }}</span>
    </header>
    <div v-if="error" class="notice error">{{ error }}</div>

    <!-- Only when something is waiting; each line goes where it is handled. -->
    <section v-if="waiting" class="card home__waiting">
      <h2 class="home__label">{{ t('待處理') }}</h2>
      <RouterLink v-if="unread.bookings" to="/app/bookings" class="home__row">
        <span>{{ t(`${unread.bookings} 個新預約等你回覆`) }}</span>
        <span class="home__go">{{ t('查看') }}</span>
      </RouterLink>
      <RouterLink v-if="unread.support" to="/support" class="home__row">
        <span>{{ t('客服回覆了你') }}</span>
        <span class="home__go">{{ t('查看') }}</span>
      </RouterLink>
    </section>

    <div class="home__actions">
      <RouterLink to="/app/new?paste=1" class="button secondary">{{ t('貼群文字') }}</RouterLink>
      <RouterLink to="/app/profile-page" class="button secondary">{{ t('分享名片') }}</RouterLink>
    </div>
    <p v-if="fee?.enabled && !fee.exempt" class="hint home__fee">
      {{ t(`每出一張單扣 ${money(fee.feePerOrder)} 點數，取消會退回。目前餘額 ${money(balance)}。`) }}
    </p>

    <section class="card">
      <h2 class="home__label">{{ t('今天和明天的行程') }}</h2>
      <RouterLink v-for="order in myTrips" :key="order.code" :to="`/app/orders/${order.id}`" class="home__trip">
        <div class="home__trip-top">
          <strong>{{ pickup(order.pickupAt) }}</strong>
          <span v-if="timeUntil(order.pickupAt, now)" class="home__until">{{ t(timeUntil(order.pickupAt, now) ?? '') }}</span>
        </div>
        <span class="home__route">{{ t(`${order.origin} 至 ${order.destination}`) }}</span>
        <span v-if="!order.passengerContact && order.contactRevealAt" class="home__note">{{ t(`乘客電話 ${shortTime(order.contactRevealAt)} 顯示`) }}</span>
        <span v-else-if="order.selfDrive" class="home__note">{{ t('這段你自己做') }}</span>
      </RouterLink>
      <p v-if="loaded && myTrips.length === 0" class="home__empty">{{ t('今天和明天沒有行程。在群裡看到單，點連結就能搶。') }}</p>
    </section>

    <RouterLink v-if="sentTotal" to="/app/orders?tab=dispatched" class="card home__summary">
      <span class="home__label">{{ t('我出的單') }}</span>
      <span class="home__counts">
        <span><strong>{{ sent.open }}</strong>{{ t('待搶') }}</span>
        <span><strong>{{ sent.taken }}</strong>{{ t('已接') }}</span>
        <span><strong>{{ sent.confirmed }}</strong>{{ t('乘客已確認') }}</span>
      </span>
    </RouterLink>

    <RouterLink v-if="pool && pool.length" to="/app/pool" class="card home__summary">
      <span class="home__label">{{ t('接單池') }}</span>
      <span>{{ t(`有 ${pool.length} 張單，最快 ${pickup(pool[0].pickupAt)} 出發`) }}</span>
    </RouterLink>

    <AdBanner position="HOME" />
  </div>
</template>

<style scoped>
.home__hello {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
  margin: var(--space-sm) 0 var(--space-lg);
}
.home__hello h1 {
  margin: 0;
}
.home__hello span {
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.home__label {
  display: block;
  margin: 0 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 600;
}
.home__waiting {
  background: var(--color-gold-tint);
  border-color: transparent;
}
.home__waiting .home__label {
  color: var(--color-gold-ink);
}
.home__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  color: var(--color-text);
  font-weight: 600;
}
.home__row + .home__row {
  border-top: 1px solid rgba(138, 90, 0, 0.15);
}
.home__go {
  color: var(--color-gold-ink);
  font-size: var(--font-label);
}
.home__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}
.home__actions .button {
  padding-inline: var(--space-sm);
  white-space: nowrap;
}
.home__fee {
  margin: calc(var(--space-sm) * -1) 0 var(--space-lg);
}
.home__trip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-sm) 0;
  color: var(--color-text);
}
.home__trip + .home__trip {
  border-top: 1px solid var(--color-divider);
}
.home__trip-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
}
.home__trip-top strong {
  font-variant-numeric: tabular-nums;
}
.home__until {
  color: var(--color-teal);
  font-size: var(--font-label);
  font-weight: 700;
  white-space: nowrap;
}
.home__route {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.home__note {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.home__empty {
  margin: 0;
  color: var(--color-text-secondary);
}
.home__summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--color-text);
}
.home__summary .home__label {
  margin: 0;
}
.home__counts {
  display: flex;
  gap: var(--space-lg);
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.home__counts strong {
  margin-right: var(--space-xs);
  color: var(--color-text);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
</style>
