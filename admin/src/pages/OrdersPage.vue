<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import PagerBar from '../components/PagerBar.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { dateTime, hkd, money, ORDER_STATUS } from '../format';
import { useListQuery, useRowLink } from '../list-query';

interface Person {
  id: string;
  name: string | null;
  phone: string;
}

interface OrderRow {
  id: string;
  code: string;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  driverPrice: { amount: number; currency: string } | null;
  serviceFee: number | null;
  dispatcher: Person;
  claimedBy: Person | null;
  /** Taken by a driver whose account was deleted since. */
  driverDeleted: boolean;
  claimAttempts: number;
  passengerConfirmed: boolean;
  selfDrive: boolean;
  legIndex: number | null;
  /** TRANSFER (接駁) or ROUND_TRIP (往返); null outside a trip. */
  journeyKind: 'TRANSFER' | 'ROUND_TRIP' | null;
  /** 包車: the hours booked, in minutes; null for any other order. */
  charterMinutes: number | null;
  paidAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

const result = ref<{ total: number; pageSize: number; items: OrderRow[] } | null>(null);
const error = ref('');
const loading = ref(false);
const rowLink = useRowLink();

// The overview's cards open this page already filtered, through the same address.
const list = useListQuery({ q: '', status: '', money: '', by: 'pickup', from: '', to: '', user: '', role: '' }, async (query) => {
  error.value = '';
  loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(query.page) });
    for (const key of ['q', 'status', 'money', 'from', 'to', 'user', 'role'] as const) if (query[key]) params.set(key, query[key]);
    if (query.from || query.to) params.set('by', query.by);
    result.value = await api('GET', `/orders?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
const { filters } = list;

/** 收款與結清, as the dispatcher marked them. Nothing to say before a driver has the order. */
/** One mark a line, so the column stays narrow. */
function moneyMarks(order: OrderRow): string[] {
  if (order.status === 'OPEN' || order.status === 'CANCELLED') return ['—'];
  const paid = order.paidAt ? '已收款' : '未收款';
  if (order.selfDrive) return [paid];
  return order.status === 'COMPLETED' ? [paid, order.settledAt ? '已結清' : '未結清'] : [paid];
}
</script>

<template>
  <div class="page-head">
    <div class="page-head__title">
      <h1>訂單</h1>
      <span v-if="result" class="muted">{{ list.filtered.value ? '符合' : '共' }} {{ result.total }} 張</span>
    </div>
  </div>
  <form class="filters" @submit.prevent="list.apply()">
    <input v-model="filters.q" class="input orders__search" type="search" placeholder="單號、地點或手機號碼" />
    <select v-model="filters.status" class="select" aria-label="狀態" @change="list.apply()">
      <option value="">全部狀態</option>
      <option v-for="(label, key) in ORDER_STATUS" :key="key" :value="key">{{ label }}</option>
    </select>
    <select v-model="filters.money" class="select orders__money" aria-label="收款與結清" @change="list.apply()">
      <option value="">收款與結清：全部</option>
      <option value="UNPAID">未收款（已有司機或已完成）</option>
      <option value="UNSETTLED">未結清（已完成、別的司機接）</option>
    </select>
    <span class="filters__group">
      <select v-model="filters.by" class="select" aria-label="日期依據" @change="(filters.from || filters.to) && list.apply()">
        <option value="pickup">出發日期</option>
        <option value="created">出單日期</option>
      </select>
      <input v-model="filters.from" class="input filters__date" type="date" aria-label="從" @change="list.apply()" />
      <span class="muted">至</span>
      <input v-model="filters.to" class="input filters__date" type="date" aria-label="到" @change="list.apply()" />
    </span>
    <button class="button secondary" type="submit">搜尋</button>
    <button v-if="list.filtered.value" class="filters__clear" type="button" @click="list.clear()">清除篩選</button>
  </form>
  <!-- Opened from a user's page: only that user's orders, until this is taken off. -->
  <p v-if="filters.user" class="filters__chip">
    只看
    <RouterLink :to="`/users/${filters.user}`">這位用戶</RouterLink>
    {{ filters.role === 'dispatcher' ? '出的單' : filters.role === 'driver' ? '接的單' : '出或接的單' }}
    <button type="button" aria-label="取消只看這位用戶" @click="list.apply({ user: '', role: '' })">取消</button>
  </p>
  <div v-if="error" class="notice error">{{ error }} <button class="button secondary" type="button" @click="list.goTo(list.page.value)">重試</button></div>
  <div v-if="result" class="card table-wrap" :class="{ 'is-loading': loading }">
    <table class="table table--links">
      <thead>
        <tr>
          <th>出發時間</th>
          <th>路線</th>
          <th>狀態</th>
          <th>出單者</th>
          <th>接單司機</th>
          <th class="num">出單價</th>
          <th class="col-wide">收款／結清</th>
          <th class="num col-wide">服務費</th>
          <th class="num col-wide">搶單</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="order in result.items" :key="order.id" @click="rowLink(`/orders/${order.id}`)($event)">
          <td class="nowrap">
            <RouterLink :to="`/orders/${order.id}`" class="cell-title">{{ dateTime(order.pickupAt) }}</RouterLink>
            <div class="hint">單號 {{ order.code }}</div>
          </td>
          <td class="orders__route">
            {{ order.origin }} 至 {{ order.destination }}
            <div v-if="order.charterMinutes" class="hint">包車 {{ order.charterMinutes / 60 }} 小時</div>
            <div v-if="order.legIndex" class="hint">{{ order.journeyKind === 'ROUND_TRIP' ? `往返${order.legIndex === 1 ? '去程' : '回程'}` : `接駁第 ${order.legIndex} 段` }}</div>
          </td>
          <td class="nowrap">
            <StatusBadge :status="order.status" :confirmed="order.passengerConfirmed" />
            <div v-for="mark in moneyMarks(order)" :key="mark" class="narrow-only hint">{{ mark }}</div>
          </td>
          <td class="nowrap">
            <RouterLink :to="`/users/${order.dispatcher.id}`" class="clip" :title="order.dispatcher.name ?? undefined">{{ order.dispatcher.name ?? '未填姓名' }}</RouterLink>
            <div class="hint">{{ order.dispatcher.phone }}</div>
          </td>
          <td class="nowrap">
            <template v-if="order.selfDrive"><span class="muted">出單者自己做</span></template>
            <template v-else-if="order.claimedBy">
              <RouterLink :to="`/users/${order.claimedBy.id}`" class="clip" :title="order.claimedBy.name ?? undefined">{{ order.claimedBy.name ?? '未填姓名' }}</RouterLink>
              <div class="hint">{{ order.claimedBy.phone }}</div>
            </template>
            <span v-else-if="order.driverDeleted" class="muted">司機已刪除</span>
            <span v-else class="muted">—</span>
          </td>
          <td class="num">
            {{ money(order.driverPrice) }}
            <div class="narrow-only hint">服務費 {{ hkd(order.serviceFee) }}・搶單 {{ order.claimAttempts }}</div>
          </td>
          <td class="nowrap col-wide">
            <div v-for="mark in moneyMarks(order)" :key="mark">{{ mark }}</div>
          </td>
          <td class="num col-wide">{{ hkd(order.serviceFee) }}</td>
          <td class="num col-wide">{{ order.claimAttempts }}</td>
        </tr>
        <tr v-if="result.items.length === 0" class="table__empty">
          <td colspan="9" class="muted">
            沒有符合的訂單。<button v-if="list.filtered.value" class="filters__clear" type="button" @click="list.clear()">清除篩選</button>
          </td>
        </tr>
      </tbody>
    </table>
    <PagerBar :page="list.page.value" :page-size="result.pageSize" :total="result.total" @change="list.goTo" />
  </div>
  <p v-else-if="loading" class="card muted">載入中…</p>
  <p class="hint">收款與結清是出單者自己的記號，平台不經手車費，也不核對。</p>
</template>

<style scoped>
/*
 * Every filter on one line at 1280px: the search takes what the others leave, and 收款與結清 is as wide
 * as its first choice, not its longest (a longer choice shows cut, in full when the list is open).
 */
.filters .orders__search {
  flex: 1 1 180px;
}

.orders__money {
  width: 170px;
}

.filters .filters__date {
  width: 136px;
}

/* Wide enough that a route reads on two lines at most, narrow enough for nine columns in the card. */
.orders__route {
  min-width: 140px;
}
</style>
