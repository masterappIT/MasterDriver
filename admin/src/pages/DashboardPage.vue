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
  money: { unpaidCompleted: number; unsettledCompleted: number };
  bookings: { thisWeek: number; pending: number };
  freePeriods: { name: string; endsAt: string | null }[];
}

const data = ref<Dashboard | null>(null);
const error = ref('');
const loading = ref(false);
const updatedAt = ref<Date | null>(null);

async function load() {
  error.value = '';
  loading.value = true;
  try {
    data.value = await api<Dashboard>('GET', '/dashboard');
    updatedAt.value = new Date();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="dashboard__title">
    <h1>總覽</h1>
    <button type="button" class="button" :disabled="loading" @click="load">{{ loading ? '載入中…' : '重新整理' }}</button>
  </div>
  <div v-if="error" class="notice error">{{ error }}{{ data ? '，下方數字可能不是最新' : '' }}</div>
  <p v-if="loading && !data" class="card muted">載入中…</p>
  <template v-if="data">
    <div v-if="data.developmentLoginEnabled" class="notice warning">
      開發模式登入目前<strong>開啟</strong>：所有號碼都可用指定碼登入，不會發簡訊。正式上線前請到「登入配置」關閉。
    </div>
    <div v-for="period in data.freePeriods" :key="period.name" class="notice">
      全站免費期「{{ period.name }}」生效中{{ period.endsAt ? `，至 ${dateTime(period.endsAt)}` : '，未設結束時間' }}。
    </div>

    <template v-if="can.write()">
      <div class="dashboard__heading">
        <div>
          <h2>待處理事項</h2>
          <p class="muted">點選卡片查看待處理內容。</p>
        </div>
        <p v-if="updatedAt" class="hint">更新時間 {{ dateTime(updatedAt.toISOString()) }}</p>
      </div>
      <div class="dashboard__metrics dashboard__metrics--priority">
        <RouterLink to="/support" class="dashboard__card dashboard__card--action">
          <span>客服待回覆</span>
          <strong>{{ data.supportWaiting }}</strong>
          <small>查看客服收件匣</small>
        </RouterLink>
      </div>
    </template>

    <div class="dashboard__heading">
      <div>
        <h2>營運概覽</h2>
        <p class="muted">用戶總數與點數餘額為累計資料，其餘依各卡片標示的期間。</p>
      </div>
      <p v-if="updatedAt && !can.write()" class="hint">更新時間 {{ dateTime(updatedAt.toISOString()) }}</p>
    </div>
    <div class="dashboard__metrics">
      <article class="dashboard__card">
        <span>用戶總數</span>
        <strong>{{ data.users.total }}</strong>
        <small>近 7 天新增 {{ data.users.newThisWeek }}</small>
      </article>
      <RouterLink to="/orders" class="dashboard__card dashboard__card--link">
        <span>今日出單</span>
        <strong>{{ data.orders.today }}</strong>
        <small>近 7 天 {{ data.orders.thisWeek }} 張・查看訂單</small>
      </RouterLink>
      <article class="dashboard__card">
        <span>近 7 天出單者</span>
        <strong>{{ data.activeDispatchersThisWeek }}</strong>
        <small>搶單嘗試 {{ data.claimsThisWeek }} 次</small>
      </article>
      <article class="dashboard__card">
        <span>用戶點數餘額合計</span>
        <strong>{{ hkd(data.creditsOutstanding) }}</strong>
        <small>平台服務費：{{ data.serviceFee.enabled ? `開啟，每單 ${money(data.serviceFee.fee)}` : '關閉' }}</small>
      </article>
      <article class="dashboard__card">
        <span>近 7 天名片頁預約</span>
        <strong>{{ data.bookings.thisWeek }}</strong>
        <small>等司機回覆 {{ data.bookings.pending }} 個</small>
      </article>
      <RouterLink to="/orders?money=UNPAID" class="dashboard__card dashboard__card--link">
        <span>已完成未收款</span>
        <strong>{{ data.money.unpaidCompleted }}</strong>
        <small>出單者自己的記號・查看訂單</small>
      </RouterLink>
      <RouterLink to="/orders?money=UNSETTLED" class="dashboard__card dashboard__card--link">
        <span>已完成未結清</span>
        <strong>{{ data.money.unsettledCompleted }}</strong>
        <small>出單者與接單司機之間・查看訂單</small>
      </RouterLink>
    </div>

    <section class="card dashboard__status">
      <h2>近 7 天訂單狀態</h2>
      <div class="dashboard__status-list">
        <div v-for="(label, status) in ORDER_STATUS" :key="status">
          <span class="muted">{{ label }}</span>
          <strong>{{ data.orders.thisWeekByStatus[status] ?? 0 }}</strong>
        </div>
      </div>
    </section>
  </template>
</template>

<style scoped>
.dashboard__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.dashboard__heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  margin: 26px 0 16px;
}

.dashboard__heading h2 {
  margin: 0;
}

.dashboard__heading p {
  margin: 5px 0 0;
  font-size: var(--font-label);
}

.dashboard__heading .hint {
  white-space: nowrap;
}

.dashboard__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

.dashboard__metrics--priority {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: 920px;
}

/* Metric card with the corner circle, as on the Master Travel dashboard. */
.dashboard__card {
  position: relative;
  display: block;
  min-width: 0;
  min-height: 148px;
  padding: 25px;
  overflow: hidden;
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-card);
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: var(--shadow-card);
  text-align: left;
}

.dashboard__card::after {
  content: '';
  position: absolute;
  right: -38px;
  bottom: -45px;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: #e9f2ff;
  pointer-events: none;
}

.dashboard__card span {
  display: block;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
  font-weight: 650;
}

.dashboard__card strong {
  display: block;
  margin-top: 18px;
  font-size: 36px;
  line-height: 1.15;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
}

.dashboard__card small {
  position: relative;
  z-index: 1;
  display: block;
  margin-top: 8px;
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}

.dashboard__card--action {
  border-color: #bcd6f7;
  background: #fafdff;
}

.dashboard__card--action small {
  color: var(--color-primary);
  font-weight: 750;
}

.dashboard__card--link:hover,
.dashboard__card--action:hover {
  border-color: var(--color-primary);
  text-decoration: none;
}

.dashboard__status {
  margin-top: 18px;
}

.dashboard__status-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.dashboard__status-list div {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid #e1eaf4;
  border-radius: 10px;
  background: #f8fbff;
}

.dashboard__status-list strong {
  font-size: 20px;
}

@media (max-width: 1100px) {
  .dashboard__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .dashboard__heading {
    align-items: stretch;
    flex-direction: column;
  }

  .dashboard__heading .hint {
    white-space: normal;
  }

  .dashboard__metrics {
    gap: 8px;
  }

  .dashboard__card {
    min-height: 96px;
    padding: 13px;
    border-radius: 13px;
  }

  .dashboard__card strong {
    margin-top: 7px;
    font-size: 26px;
  }

  .dashboard__status-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .dashboard__metrics,
  .dashboard__metrics--priority {
    grid-template-columns: 1fr;
  }
}
</style>
