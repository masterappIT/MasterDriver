<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge.vue';
import { dateTime, hkd, money } from '../format';

type Money = { amount: number; currency: string } | null;

interface OrderDetail {
  code: string;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  notes: string | null;
  driverPrice: Money;
  passengerPrice: Money;
  showPassengerPrice: boolean;
  margin: Money;
  serviceFee: number | null;
  passenger: { name: string | null; contact: string } | null;
  dispatcher: { id: string; name: string | null; phone: string };
  driver: {
    name: string | null;
    phone: string;
    profile: { hkPlate: string | null; macauPlate: string | null; mainlandPlate: string | null } | null;
  } | null;
  timeline: Record<string, string | null>;
  claims: { result: string; createdAt: string; driver: { id: string; name: string | null; phone: string } }[];
}

const TIMELINE: Record<string, string> = {
  createdAt: '出單',
  claimedAt: '被搶到',
  passengerConfirmedAt: '乘客確認',
  completedAt: '完成',
  cancelledAt: '取消',
};

const route = useRoute();
const order = ref<OrderDetail | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    order.value = await api<OrderDetail>('GET', `/orders/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <RouterLink to="/orders" class="hint">返回訂單</RouterLink>
  <div v-if="error" class="notice error">{{ error }}</div>
  <template v-if="order">
    <h1>{{ order.origin }} 至 {{ order.destination }}　<StatusBadge :status="order.status" /></h1>
    <div class="card">
      <div class="row">
        <span>出發：{{ dateTime(order.pickupAt) }}</span>
        <span>單號：{{ order.code }}</span>
        <span>{{ order.passengers }} 人・{{ order.luggage }} 件行李{{ order.vehicleType ? `・${order.vehicleType}` : '' }}</span>
      </div>
      <p v-if="order.waypoints.length">途經：{{ order.waypoints.join('、') }}</p>
      <p v-if="order.notes">備註：{{ order.notes }}</p>
    </div>

    <div class="grid">
      <div class="card">
        <div class="muted">出單價</div>
        <div class="stat">{{ money(order.driverPrice) }}</div>
      </div>
      <div class="card">
        <div class="muted">乘客價</div>
        <div class="stat">{{ money(order.passengerPrice) }}</div>
        <div class="hint">{{ order.showPassengerPrice ? '乘客看得到' : '乘客看不到' }}</div>
      </div>
      <div class="card">
        <div class="muted">差價</div>
        <div class="stat">{{ money(order.margin) }}</div>
      </div>
      <div class="card">
        <div class="muted">平台服務費</div>
        <div class="stat">{{ hkd(order.serviceFee) }}</div>
      </div>
    </div>

    <div class="card">
      <h2>相關人員</h2>
      <p>
        出單者：<RouterLink :to="`/users/${order.dispatcher.id}`">{{ order.dispatcher.name ?? '未填姓名' }}（{{ order.dispatcher.phone }}）</RouterLink>
      </p>
      <p v-if="order.driver">
        接單司機：{{ order.driver.name ?? '未填姓名' }}（{{ order.driver.phone }}）
        <span class="muted">
          {{ [order.driver.profile?.hkPlate, order.driver.profile?.macauPlate, order.driver.profile?.mainlandPlate].filter(Boolean).join(' / ') }}
        </span>
      </p>
      <p v-if="order.passenger">乘客：{{ order.passenger.name ?? '—' }}（{{ order.passenger.contact }}）<span class="hint">查看乘客資料已記錄在操作紀錄</span></p>
      <p v-else class="muted">你的角色看不到乘客資料</p>
    </div>

    <div class="card">
      <h2>時間線</h2>
      <div class="row">
        <span v-for="(label, key) in TIMELINE" :key="key" :class="{ muted: !order.timeline[key] }">
          {{ label }}：{{ dateTime(order.timeline[key]) }}
        </span>
      </div>
    </div>

    <div class="card table-wrap">
      <h2>搶單紀錄</h2>
      <table class="table">
        <thead>
          <tr>
            <th>時間</th>
            <th>司機</th>
            <th>結果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(claim, i) in order.claims" :key="i">
            <td>{{ dateTime(claim.createdAt) }}</td>
            <td><RouterLink :to="`/users/${claim.driver.id}`">{{ claim.driver.name ?? '未填姓名' }}（{{ claim.driver.phone }}）</RouterLink></td>
            <td>{{ claim.result === 'WON' ? '搶到' : '落空' }}</td>
          </tr>
          <tr v-if="order.claims.length === 0">
            <td colspan="3" class="muted">還沒有人搶單</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
