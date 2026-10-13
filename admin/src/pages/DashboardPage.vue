<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, can } from '../api';
import { dateTime, hkd, money, ORDER_STATUS } from '../format';

interface Dashboard {
  users: { total: number; newThisWeek: number };
  orders: { today: number; thisWeek: number; thisWeekByStatus: Record<string, number> };
  claimsThisWeek: number;
  activeDispatchersThisWeek: number;
  creditsOutstanding: number;
  serviceFee: { enabled: boolean; fee: { amount: number; currency: string } };
  developmentLoginEnabled: boolean;
  supportWaiting: number;
  freePeriods: { name: string; endsAt: string | null }[];
}

const data = ref<Dashboard | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    data.value = await api<Dashboard>('GET', '/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <h1>總覽</h1>
  <div v-if="error" class="notice error">{{ error }}</div>
  <template v-if="data">
    <div v-if="data.developmentLoginEnabled" class="notice warning">
      開發模式登入目前<strong>開啟</strong>：所有號碼都可用指定碼登入，不會發簡訊。正式上線前請到「登入配置」關閉。
    </div>
    <div v-for="period in data.freePeriods" :key="period.name" class="notice">
      全站免費期「{{ period.name }}」生效中{{ period.endsAt ? `，至 ${dateTime(period.endsAt)}` : '，未設結束時間' }}。
    </div>

    <RouterLink v-if="data.supportWaiting > 0 && can.write()" to="/support" class="notice warning dashboard__support">
      客服有 <strong>{{ data.supportWaiting }}</strong> 個對話等待回覆 →
    </RouterLink>

    <div class="grid">
      <div class="card">
        <div class="muted">用戶總數</div>
        <div class="stat">{{ data.users.total }}</div>
        <div class="hint">近 7 天新增 {{ data.users.newThisWeek }}</div>
      </div>
      <div class="card">
        <div class="muted">今日發單</div>
        <div class="stat">{{ data.orders.today }}</div>
        <div class="hint">近 7 天 {{ data.orders.thisWeek }} 張</div>
      </div>
      <div class="card">
        <div class="muted">近 7 天派單者</div>
        <div class="stat">{{ data.activeDispatchersThisWeek }}</div>
        <div class="hint">搶單嘗試 {{ data.claimsThisWeek }} 次</div>
      </div>
      <div class="card">
        <div class="muted">用戶點數餘額合計</div>
        <div class="stat">{{ hkd(data.creditsOutstanding) }}</div>
        <div class="hint">
          平台服務費：{{ data.serviceFee.enabled ? `開啟，每單 ${money(data.serviceFee.fee)}` : '關閉' }}
        </div>
      </div>
    </div>

    <div class="card">
      <h2>近 7 天訂單狀態</h2>
      <div class="row">
        <span v-for="(label, status) in ORDER_STATUS" :key="status" class="muted">
          {{ label }}：<strong>{{ data.orders.thisWeekByStatus[status] ?? 0 }}</strong>
        </span>
      </div>
    </div>
  </template>
</template>

<style scoped>
.dashboard__support {
  display: block;
}
</style>
