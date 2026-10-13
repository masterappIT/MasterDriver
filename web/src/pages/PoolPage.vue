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
      <p class="hint">{{ t('派單的人自己選擇放進來的單。先到先得，和群裡的連結是同一張單。') }}</p>
      <form class="pool-page__filters" @submit.prevent="load">
        <input v-model="date" class="input" type="date" :aria-label="t('出發日期')" @change="load" />
        <input v-model="keyword" class="input" type="search" maxlength="40" :placeholder="t('地點，例如：機場')" :aria-label="t('地點')" />
        <button class="button secondary" type="submit">{{ t('搜尋') }}</button>
      </form>
      <div v-if="error" class="notice error">{{ error }}</div>
      <OrderCard v-for="order in orders" :key="order.code" :order="order" role="pool" />
      <div v-if="loaded && !error && orders.length === 0" class="card muted">
        <template v-if="date || keyword.trim()">
          {{ t('沒有符合的單。') }}
          <button class="chip" type="button" @click="clear">{{ t('清除篩選') }}</button>
        </template>
        <template v-else>{{ t('接單池目前沒有單。在群裡看到單，點連結一樣可以搶。') }}</template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pool-page__filters {
  display: flex;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}
.pool-page__filters .input {
  min-width: 0;
  flex: 1;
}
.pool-page__filters .button {
  flex-shrink: 0;
}
</style>
