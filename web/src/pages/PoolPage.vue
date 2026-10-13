<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api, errorText, session } from '../api';
import OrderCard, { type OrderSummary } from '../components/OrderCard.vue';
import PoolRadar from '../components/PoolRadar.vue';
import ProfileForm from '../components/ProfileForm.vue';
import { t } from '../i18n';

/**
 * 接單池: orders their dispatchers chose to list for every signed-in driver.
 * Each one opens its claim page, the same page as the link in a group.
 * The pool looks again on its own (no pull to refresh, which fights WeChat's own gesture).
 */
const REFRESH_MS = 15_000;
const orders = ref<OrderSummary[]>([]);
const date = ref('');
const error = ref('');
const loaded = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  if (!session.profile) return;
  const query = new URLSearchParams();
  if (date.value) query.set('date', date.value);
  try {
    orders.value = await api<OrderSummary[]>('GET', `/orders/pool?${query}`);
    error.value = '';
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
}

/** "YYYY-MM-DD" in Hong Kong, `days` from today, for the 今天 / 明天 chips. */
function hongKongDay(days: number) {
  return new Date(Date.now() + 8 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const today = hongKongDay(0);
const tomorrow = hongKongDay(1);

function pickDay(day: string) {
  date.value = date.value === day ? '' : day;
  void load();
}

function clear() {
  date.value = '';
  void load();
}

/** Back on the page: look at once. Hidden: stop asking. */
function onVisible() {
  if (document.visibilityState === 'visible') void load();
}

onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', onVisible);
});
</script>

<template>
  <div class="page">
    <header class="pool-page__head">
      <h1>{{ t('接單池') }}</h1>
      <PoolRadar v-if="session.profile && orders.length" :size="28" />
    </header>

    <section v-if="!session.profile" class="card">
      <p>{{ t('填好司機資料（姓名、車牌）就能看接單池，搶單時也要用到。') }}</p>
      <ProfileForm @saved="load" />
    </section>

    <template v-else>
      <div class="chips pool-page__days">
        <button class="chip" :class="{ 'chip--on': date === today }" type="button" :aria-pressed="date === today" @click="pickDay(today)">{{ t('今天') }}</button>
        <button class="chip" :class="{ 'chip--on': date === tomorrow }" type="button" :aria-pressed="date === tomorrow" @click="pickDay(tomorrow)">{{ t('明天') }}</button>
        <!-- Another day: a chip that is also a date picker. -->
        <label class="chip pool-page__date" :class="{ 'chip--on': date && date !== today && date !== tomorrow }">
          {{ date && date !== today && date !== tomorrow ? date.slice(5).replace('-', '/') : t('其他日子') }}
          <input v-model="date" type="date" :aria-label="t('出發日期')" @change="load" />
        </label>
        <button v-if="date" class="chip" type="button" @click="clear">{{ t('全部日子') }}</button>
      </div>
      <div v-if="error" class="notice error">{{ error }}</div>
      <OrderCard v-for="order in orders" :key="order.code" :order="order" role="pool" />

      <!-- Nothing yet: the radar keeps turning while the pool looks again every few seconds. -->
      <div v-if="!error && orders.length === 0" class="pool-page__scan" role="status">
        <PoolRadar />
        <strong>{{ loaded ? (date ? t('這天暫時沒有單') : t('正在找單')) : t('正在載入') }}</strong>
        <span>{{ t('出單者放進接單池的單會自動出現，先到先得。在群裡看到單，點連結一樣可以搶。') }}</span>
      </div>
      <p v-else-if="orders.length" class="hint pool-page__note">{{ t('出單者自己選擇放進來的單，和群裡的連結是同一張單。每 15 秒自動更新。') }}</p>
    </template>
  </div>
</template>

<style scoped>
.pool-page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.pool-page__head h1 {
  margin: 0;
}
.pool-page__days {
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}
.pool-page__date {
  position: relative;
  overflow: hidden;
}
/* The real date input covers the chip, so a tap opens the phone's own date picker. */
.pool-page__date input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
/* The radar in the middle of the screen while the pool is empty. */
.pool-page__scan {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-xl);
  padding: 0 var(--space-lg);
  text-align: center;
}
.pool-page__scan strong {
  margin-top: var(--space-md);
  font-size: var(--font-body-large);
}
.pool-page__scan span {
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.pool-page__note {
  margin: var(--space-sm) var(--space-xs) 0;
  text-align: center;
}
</style>
