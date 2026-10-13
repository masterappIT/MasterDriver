<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorText, session } from '../api';
import OrderCard, { type OrderSummary } from '../components/OrderCard.vue';
import ProfileForm from '../components/ProfileForm.vue';
import { t } from '../i18n';

/**
 * 接單池: orders their dispatchers chose to list for every signed-in driver.
 * Each one opens its claim page, the same page as the link in a group.
 */
const orders = ref<OrderSummary[]>([]);
const date = ref('');
const keyword = ref('');
const error = ref('');
const loaded = ref(false);

async function load() {
  if (!session.profile) return;
  error.value = '';
  const query = new URLSearchParams();
  if (date.value) query.set('date', date.value);
  if (keyword.value.trim()) query.set('q', keyword.value.trim());
  try {
    orders.value = await api<OrderSummary[]>('GET', `/orders/pool?${query}`);
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
  keyword.value = '';
  void load();
}

onMounted(load);
</script>

<template>
  <div class="page">
    <h1>{{ t('接單池') }}</h1>

    <section v-if="!session.profile" class="card">
      <p>{{ t('填好司機資料（姓名、車牌）就能看接單池，搶單時也要用到。') }}</p>
      <ProfileForm @saved="load" />
    </section>

    <template v-else>
      <p class="hint pool-page__intro">{{ t('出單者自己選擇放進來的單。先到先得，和群裡的連結是同一張單。') }}</p>
      <form class="pool-page__search" role="search" @submit.prevent="load">
        <input v-model="keyword" type="search" maxlength="40" :placeholder="t('搜地點，例如：機場')" :aria-label="t('地點')" />
        <button type="submit">{{ t('搜尋') }}</button>
      </form>
      <div class="chips pool-page__days">
        <button class="chip" :class="{ 'chip--on': date === today }" type="button" :aria-pressed="date === today" @click="pickDay(today)">{{ t('今天') }}</button>
        <button class="chip" :class="{ 'chip--on': date === tomorrow }" type="button" :aria-pressed="date === tomorrow" @click="pickDay(tomorrow)">{{ t('明天') }}</button>
        <!-- Another day: a chip that is also a date picker. -->
        <label class="chip pool-page__date" :class="{ 'chip--on': date && date !== today && date !== tomorrow }">
          {{ date && date !== today && date !== tomorrow ? date.slice(5).replace('-', '/') : t('其他日子') }}
          <input v-model="date" type="date" :aria-label="t('出發日期')" @change="load" />
        </label>
        <button v-if="date || keyword.trim()" class="chip" type="button" @click="clear">{{ t('清除') }}</button>
      </div>
      <div v-if="error" class="notice error">{{ error }}</div>
      <OrderCard v-for="order in orders" :key="order.code" :order="order" role="pool" />
      <div v-if="loaded && !error && orders.length === 0" class="card muted">
        <template v-if="date || keyword.trim()">{{ t('沒有符合的單。') }}</template>
        <template v-else>{{ t('接單池目前沒有單。在群裡看到單，點連結一樣可以搶。') }}</template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pool-page__intro {
  margin: calc(var(--space-sm) * -1) 0 var(--space-md);
}
/* One capsule for the place, with 搜尋 inside it. */
.pool-page__search {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-md);
  padding: 4px 4px 4px var(--space-lg);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-pill);
  background: var(--color-card);
  box-shadow: var(--shadow-card);
}
.pool-page__search input {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 16px;
  outline: none;
}
.pool-page__search button {
  flex-shrink: 0;
  min-height: 40px;
  padding: 0 var(--space-lg);
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
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
</style>
