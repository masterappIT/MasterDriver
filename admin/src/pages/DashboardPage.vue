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
  supportUnread: number;
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
  <div class="page-head">
    <h1>總覽</h1>
    <div class="row">
      <span v-if="updatedAt" class="hint">更新時間 {{ dateTime(updatedAt.toISOString()) }}</span>
      <button type="button" class="button secondary" :disabled="loading" @click="load">{{ loading ? '載入中…' : '重新整理' }}</button>
    </div>
  </div>
  <div v-if="error" class="notice error">{{ error }}{{ data ? '，下方數字可能不是最新' : '' }}</div>
  <p v-if="loading && !data" class="card muted">載入中…</p>
  <template v-if="data">
    <!-- What an operator has to act on, and nothing else, comes first. -->
    <section v-if="can.write()" class="card dashboard__todo">
      <h2>需要處理</h2>
      <ul class="dashboard__todo-list">
        <li :class="{ 'dashboard__todo--due': data.supportUnread > 0 }">
          <span>客服待回覆</span>
          <strong>{{ data.supportWaiting }}</strong>
          <span class="muted">
            {{ data.supportWaiting === 0 ? '目前沒有' : data.supportUnread > 0 ? `其中 ${data.supportUnread} 個有未讀訊息` : '都已讀過，等回覆或按「不用回覆」' }}
          </span>
          <RouterLink to="/support">{{ data.supportWaiting > 0 ? '去回覆' : '打開客服' }}</RouterLink>
        </li>
        <li v-if="data.developmentLoginEnabled" class="dashboard__todo--warning">
          <span>開發模式登入</span>
          <strong>開啟中</strong>
          <span class="muted">所有號碼都可用指定碼登入，不發簡訊；正式上線前要關閉</span>
          <RouterLink to="/settings/login?tab=development">去關閉</RouterLink>
        </li>
      </ul>
    </section>

    <div class="dashboard__panels">
      <section class="card">
        <div class="dashboard__panel-head">
          <h2>訂單</h2>
          <RouterLink to="/orders">查看訂單</RouterLink>
        </div>
        <dl class="facts facts--numbers">
          <div><dt>今日出單</dt><dd>{{ data.orders.today }}</dd></div>
          <div><dt>近 7 天出單</dt><dd>{{ data.orders.thisWeek }}</dd></div>
        </dl>
        <dl class="facts dashboard__facts">
          <div><dt>近 7 天出單者</dt><dd>{{ data.activeDispatchersThisWeek }} 人</dd></div>
          <div><dt>近 7 天搶單嘗試</dt><dd>{{ data.claimsThisWeek }} 次</dd></div>
        </dl>
        <p class="dashboard__label">近 7 天出的單，現在的狀態</p>
        <ul class="dashboard__status">
          <li v-for="(label, status) in ORDER_STATUS" :key="status">
            <span class="muted">{{ label }}</span>
            <strong>{{ data.orders.thisWeekByStatus[status] ?? 0 }}</strong>
          </li>
        </ul>
      </section>

      <section class="card">
        <div class="dashboard__panel-head">
          <h2>用戶</h2>
          <RouterLink to="/users">查看用戶</RouterLink>
        </div>
        <dl class="facts facts--numbers">
          <div><dt>用戶總數</dt><dd>{{ data.users.total }}</dd></div>
          <div><dt>近 7 天新增</dt><dd>{{ data.users.newThisWeek }}</dd></div>
        </dl>
        <dl class="facts dashboard__facts">
          <div><dt>近 7 天名片頁預約</dt><dd>{{ data.bookings.thisWeek }} 個</dd></div>
          <div><dt>等司機回覆的預約</dt><dd>{{ data.bookings.pending }} 個</dd></div>
        </dl>
        <p class="hint">預約由司機自己回覆，平台不介入。</p>
      </section>

      <section class="card">
        <div class="dashboard__panel-head">
          <h2>收費</h2>
          <RouterLink v-if="can.write()" to="/billing">收費控制</RouterLink>
        </div>
        <dl class="facts dashboard__facts dashboard__facts--first">
          <div class="facts__wide">
            <dt>平台服務費</dt>
            <dd>
              <span class="tag" :class="{ 'tag--info': data.serviceFee.enabled }">{{ data.serviceFee.enabled ? '開啟' : '關閉' }}</span>
              {{ data.serviceFee.enabled ? `每單 ${money(data.serviceFee.fee)}` : '' }}
            </dd>
          </div>
          <div class="facts__wide">
            <dt>全站免費期</dt>
            <dd v-if="data.freePeriods.length === 0" class="muted">沒有生效中的免費期</dd>
            <dd v-for="period in data.freePeriods" v-else :key="period.name">
              {{ period.name }}<span class="muted">（{{ period.endsAt ? `至 ${dateTime(period.endsAt)}` : '未設結束時間' }}）</span>
            </dd>
          </div>
          <div class="facts__wide"><dt>用戶點數餘額合計</dt><dd>{{ hkd(data.creditsOutstanding) }}</dd></div>
        </dl>
      </section>
    </div>

    <section class="card dashboard__marks">
      <div>
        <h2>出單者自己的記號</h2>
        <p class="hint">收款與結清由出單者自己標記，平台不經手車費、不核對，不需要後台處理；有糾紛時可從這裡查單。</p>
      </div>
      <RouterLink to="/orders?money=UNPAID" class="dashboard__mark">
        <span>已完成未收款</span>
        <strong>{{ data.money.unpaidCompleted }}</strong>
      </RouterLink>
      <RouterLink to="/orders?money=UNSETTLED" class="dashboard__mark">
        <span>已完成未結清</span>
        <strong>{{ data.money.unsettledCompleted }}</strong>
      </RouterLink>
    </section>
  </template>
</template>

<style scoped>
.dashboard__todo h2 {
  margin-bottom: var(--space-sm);
}

/* One line per thing to do: what, how many, a word on it, and where to do it. */
.dashboard__todo-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard__todo-list li {
  display: grid;
  grid-template-columns: 140px 80px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-md);
  padding: 12px 0;
  border-top: 1px solid var(--color-divider);
}

.dashboard__todo-list li:first-child {
  border-top: 0;
}

.dashboard__todo-list strong {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.dashboard__todo-list a {
  font-weight: 700;
  white-space: nowrap;
}

.dashboard__todo--due strong {
  color: var(--color-danger);
}

.dashboard__todo--warning strong {
  color: var(--color-warning-text);
  font-size: var(--font-body);
}

.dashboard__panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
  margin-bottom: 18px;
}

.dashboard__panels > .card {
  margin-bottom: 0;
}

/* Two facts side by side, however narrow the panel. */
.dashboard__panels .facts {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-md) var(--space-lg);
}

.dashboard__panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.dashboard__panel-head h2 {
  margin: 0;
}

.dashboard__panel-head a {
  font-size: var(--font-label);
  font-weight: 600;
}

.dashboard__facts {
  margin-top: var(--space-lg);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--color-divider);
}

.dashboard__facts--first {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.dashboard__label {
  margin: var(--space-lg) 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}

.dashboard__status {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard__status li {
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-input);
  background: var(--color-field);
  font-size: var(--font-caption);
}

.dashboard__status strong {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.dashboard__panels .hint {
  margin: var(--space-md) 0 0;
}

/* The dispatchers' own marks: for looking up, not for acting on. */
.dashboard__marks {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(2, 180px);
  align-items: center;
  gap: var(--space-lg);
}

.dashboard__marks h2 {
  margin-bottom: 4px;
}

.dashboard__marks .hint {
  margin: 0;
}

.dashboard__mark {
  display: grid;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-input);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}

.dashboard__mark strong {
  color: var(--color-text);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.dashboard__mark:hover {
  border-color: var(--color-primary);
  text-decoration: none;
}

@media (max-width: 700px) {
  .dashboard__todo-list li {
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 4px var(--space-md);
  }

  .dashboard__todo-list li > .muted {
    grid-column: 1 / -1;
    grid-row: 2;
    font-size: var(--font-caption);
  }

  .dashboard__status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard__marks {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard__marks > div {
    grid-column: 1 / -1;
  }
}
</style>
