<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
}

const q = ref('');
const status = ref('');
const page = ref(1);
const result = ref<{ total: number; pageSize: number; items: OrderRow[] } | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value) });
    if (q.value) params.set('q', q.value);
    if (status.value) params.set('status', status.value);
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

onMounted(load);
</script>

<template>
  <h1>訂單</h1>
  <div class="card">
    <form class="row" @submit.prevent="search">
      <input v-model="q" class="input" placeholder="單號、地點或手機號碼" />
      <select v-model="status" class="select" @change="search">
        <option value="">全部狀態</option>
        <option v-for="(label, key) in ORDER_STATUS" :key="key" :value="key">{{ label }}</option>
      </select>
      <button class="button" type="submit">搜尋</button>
    </form>
  </div>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="result" class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>出發時間</th>
          <th>路線</th>
          <th>狀態</th>
          <th>司機價</th>
          <th>服務費</th>
          <th>出單者</th>
          <th>接單司機</th>
          <th>搶單次數</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="order in result.items" :key="order.id">
          <td class="nowrap"><RouterLink :to="`/orders/${order.id}`">{{ dateTime(order.pickupAt) }}</RouterLink></td>
          <td class="wide">{{ order.origin }} 至 {{ order.destination }}</td>
          <td><StatusBadge :status="order.status" :confirmed="order.passengerConfirmed" /></td>
          <td class="nowrap">{{ money(order.driverPrice) }}</td>
          <td class="nowrap">{{ hkd(order.serviceFee) }}</td>
          <td class="wide">{{ who(order.dispatcher) }}</td>
          <td class="wide">{{ who(order.claimedBy) }}</td>
          <td>{{ order.claimAttempts }}</td>
        </tr>
        <tr v-if="result.items.length === 0">
          <td colspan="8" class="muted">沒有符合的訂單</td>
        </tr>
      </tbody>
    </table>
    <PagerBar :page="page" :page-size="result.pageSize" :total="result.total" @change="(p) => ((page = p), load())" />
  </div>
</template>
