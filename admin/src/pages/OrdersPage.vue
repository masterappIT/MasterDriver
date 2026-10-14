<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import PagerBar from '../components/PagerBar.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { dateTime, hkd, money, ORDER_STATUS } from '../format';

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
  claimAttempts: number;
  passengerConfirmed: boolean;
  selfDrive: boolean;
  legIndex: number | null;
  paidAt: string | null;
  settledAt: string | null;
}

const q = ref('');
const status = ref('');
/** 帳: trips still waiting on the dispatcher's own marks. */
// The dashboard's cards open this page already filtered.
const asked = useRoute().query.money;
const moneyFilter = ref(asked === 'UNPAID' || asked === 'UNSETTLED' ? asked : '');
const page = ref(1);
const result = ref<{ total: number; pageSize: number; items: OrderRow[] } | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value) });
    if (q.value) params.set('q', q.value);
    if (status.value) params.set('status', status.value);
    if (moneyFilter.value) params.set('money', moneyFilter.value);
    result.value = await api('GET', `/orders?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function search() {
  page.value = 1;
  void load();
}

const who = (person: Person | null) => (person ? `${person.name ?? '未填姓名'}（${person.phone}）` : '—');

/** 收款與結清, as the dispatcher marked them. Nothing to say before a driver has the order. */
function moneyMarks(order: OrderRow): string {
  if (order.status === 'OPEN' || order.status === 'CANCELLED') return '—';
  const paid = order.paidAt ? '已收款' : '未收款';
  if (order.selfDrive) return paid;
  return order.status === 'COMPLETED' ? `${paid}・${order.settledAt ? '已結清' : '未結清'}` : paid;
}

onMounted(load);
</script>

<template>
  <h1>訂單</h1>
  <form class="filters" @submit.prevent="search">
    <input v-model="q" class="input" placeholder="單號、地點或手機號碼" />
    <select v-model="status" class="select" @change="search">
      <option value="">全部狀態</option>
      <option v-for="(label, key) in ORDER_STATUS" :key="key" :value="key">{{ label }}</option>
    </select>
    <select v-model="moneyFilter" class="select" @change="search">
      <option value="">收款與結清：全部</option>
      <option value="UNPAID">未收款（已有司機或已完成）</option>
      <option value="UNSETTLED">未結清（已完成、別的司機接）</option>
    </select>
    <button class="button" type="submit">搜尋</button>
  </form>
  <div v-if="error" class="notice error">{{ error }}</div>
  <p class="hint orders__note">收款與結清是出單者自己的記號，平台不經手車費，也不核對。</p>
  <div v-if="result" class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>出發時間</th>
          <th>路線</th>
          <th>狀態</th>
          <th class="num">出單價</th>
          <th>收款／結清</th>
          <th class="num">服務費</th>
          <th>出單者</th>
          <th>接單司機</th>
          <th class="num">搶單次數</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="order in result.items" :key="order.id">
          <td class="nowrap"><RouterLink :to="`/orders/${order.id}`">{{ dateTime(order.pickupAt) }}</RouterLink></td>
          <td class="wide">{{ order.origin }} 至 {{ order.destination }}<span v-if="order.legIndex" class="tag">接駁第 {{ order.legIndex }} 段</span></td>
          <td><StatusBadge :status="order.status" :confirmed="order.passengerConfirmed" /></td>
          <td class="num">{{ money(order.driverPrice) }}</td>
          <td class="nowrap">{{ moneyMarks(order) }}</td>
          <td class="num">{{ hkd(order.serviceFee) }}</td>
          <td class="wide">{{ who(order.dispatcher) }}</td>
          <td class="wide">{{ order.selfDrive ? '出單者自己做' : who(order.claimedBy) }}</td>
          <td class="num">{{ order.claimAttempts }}</td>
        </tr>
        <tr v-if="result.items.length === 0">
          <td colspan="9" class="muted">沒有符合的訂單</td>
        </tr>
      </tbody>
    </table>
    <PagerBar :page="page" :page-size="result.pageSize" :total="result.total" @change="(p) => ((page = p), load())" />
  </div>
</template>

<style scoped>
.orders__note {
  display: block;
  margin: 0 0 var(--space-sm);
}
</style>
