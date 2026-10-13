<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, can } from '../api';
import { CREDIT_ENTRY, dateTime, fromLocalInput, hkd, money, PLAN_NAME } from '../format';

interface Grant {
  enabled: boolean;
  quota: number | null;
  source: string;
}

interface UserDetail {
  id: string;
  phone: string;
  locale: string;
  createdAt: string;
  profile: {
    name: string;
    hkPlate: string | null;
    macauPlate: string | null;
    mainlandPlate: string | null;
    vehicleType: string | null;
    seats: number | null;
    color: string | null;
  } | null;
  counts: { dispatched: number; claimed: number };
  credits: {
    balance: { amount: number; currency: string };
    entries: { type: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }[];
  };
  serviceFee: { enabled: boolean; feePerOrder: { amount: number; currency: string }; exempt: boolean };
  entitlements: { orderCreate: Grant; commissionExempt: Grant };
  usage: { featureKey: string; period: string; used: number }[];
  subscriptions: { id: string; planKey: string; source: string; status: string; startsAt: string; endsAt: string | null }[];
  overrides: {
    id: string;
    planKey: string | null;
    featureKey: string | null;
    startsAt: string;
    endsAt: string | null;
    reason: string;
    active: boolean;
  }[];
}

const SOURCE: Record<string, string> = {
  override: '個別贈送',
  'feature-policy': '單一功能限時免費',
  'plan-policy': '全站免費期',
  subscription: '訂閱',
  default: '預設方案',
  none: '無',
};
const PLANS = [
  { key: 'team', label: '團隊' },
  { key: 'company', label: '公司' },
];

const route = useRoute();
const router = useRouter();
const user = ref<UserDetail | null>(null);
const error = ref('');
const message = ref('');
const credit = reactive({ type: 'TOPUP' as 'TOPUP' | 'ADJUST', amount: '', note: '' });
const gift = reactive({ planKey: 'company', endsAt: '', reason: '' });

async function load() {
  try {
    user.value = await api<UserDetail>('GET', `/users/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function run(action: () => Promise<unknown>, done: string) {
  error.value = '';
  message.value = '';
  try {
    await action();
    message.value = done;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function changeCredits() {
  return run(async () => {
    await api('POST', `/users/${route.params.id}/credits`, {
      type: credit.type,
      amount: Number(credit.amount),
      note: credit.note,
    });
    credit.amount = '';
    credit.note = '';
  }, '點數已更新');
}

function giftPlan() {
  return run(async () => {
    await api('POST', `/users/${route.params.id}/overrides`, {
      planKey: gift.planKey,
      endsAt: fromLocalInput(gift.endsAt),
      reason: gift.reason,
    });
    gift.reason = '';
    gift.endsAt = '';
  }, '已贈送方案');
}

function endOverride(id: string) {
  if (!confirm('確定結束這項贈送？')) return;
  return run(() => api('DELETE', `/users/${route.params.id}/overrides/${id}`), '已結束贈送');
}

/** 主動聯繫: opens this user's 客服 conversation, creating it when there is none. */
async function contact() {
  error.value = '';
  try {
    const { id } = await api<{ id: string }>('POST', '/support/conversations', { userId: route.params.id });
    await router.push(`/support/${id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const quotaText = (grant: Grant) => (!grant.enabled ? '不可用' : grant.quota === null ? '不限' : `${grant.quota} 張`);

onMounted(load);
</script>

<template>
  <RouterLink to="/users" class="hint">← 用戶</RouterLink>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <template v-if="user">
    <h1>{{ user.profile?.name ?? '未填姓名' }}　<span class="muted">{{ user.phone }}</span></h1>
    <p v-if="can.write()"><button class="button secondary" type="button" @click="contact">用客服聯絡這位用戶</button></p>

    <div class="grid">
      <div class="card">
        <div class="muted">派單／接單</div>
        <div class="stat">{{ user.counts.dispatched }} / {{ user.counts.claimed }}</div>
      </div>
      <div class="card">
        <div class="muted">點數餘額</div>
        <div class="stat">{{ money(user.credits.balance) }}</div>
        <div class="hint">
          服務費：{{
            !user.serviceFee.enabled ? '平台未開啟' : user.serviceFee.exempt ? '免收' : `每單 ${money(user.serviceFee.feePerOrder)}`
          }}
        </div>
      </div>
      <div class="card">
        <div class="muted">每月發單額度</div>
        <div class="stat">{{ quotaText(user.entitlements.orderCreate) }}</div>
        <div class="hint">來源：{{ SOURCE[user.entitlements.orderCreate.source] }}</div>
      </div>
    </div>

    <div class="card">
      <h2>司機資料</h2>
      <p v-if="!user.profile" class="muted">尚未填寫（第一次搶單前會要求填寫）</p>
      <div v-else class="row">
        <span>港牌：{{ user.profile.hkPlate ?? '—' }}</span>
        <span>澳牌：{{ user.profile.macauPlate ?? '—' }}</span>
        <span>內地牌：{{ user.profile.mainlandPlate ?? '—' }}</span>
        <span>車型：{{ user.profile.vehicleType ?? '—' }}</span>
        <span>座位：{{ user.profile.seats ?? '—' }}</span>
        <span>車色：{{ user.profile.color ?? '—' }}</span>
      </div>
      <p class="hint">註冊：{{ dateTime(user.createdAt) }}　介面語言：{{ user.locale === 'zh-Hans' ? '簡體' : '繁體' }}</p>
    </div>

    <div class="card">
      <h2>點數</h2>
      <form v-if="can.write()" class="row" @submit.prevent="changeCredits">
        <select v-model="credit.type" class="select">
          <option value="TOPUP">人工充值</option>
          <option value="ADJUST">調整（可為負數）</option>
        </select>
        <input v-model="credit.amount" class="input" type="number" step="0.01" placeholder="金額（HK$）" required />
        <input v-model="credit.note" class="input" placeholder="備註，例如：轉數快 #123" required />
        <button class="button" type="submit">確定</button>
      </form>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>時間</th>
              <th>類型</th>
              <th>金額</th>
              <th>餘額</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, i) in user.credits.entries" :key="i">
              <td>{{ dateTime(entry.createdAt) }}</td>
              <td>{{ CREDIT_ENTRY[entry.type] ?? entry.type }}</td>
              <td>{{ hkd(entry.amount) }}</td>
              <td>{{ hkd(entry.balanceAfter) }}</td>
              <td>{{ entry.note ?? '' }}</td>
            </tr>
            <tr v-if="user.credits.entries.length === 0">
              <td colspan="5" class="muted">沒有紀錄</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>方案與贈送</h2>
      <p v-for="sub in user.subscriptions" :key="sub.id">
        訂閱：{{ PLAN_NAME[sub.planKey] ?? sub.planKey }}（{{ sub.source }}，{{ sub.status }}）{{ dateTime(sub.startsAt) }} 至 {{ dateTime(sub.endsAt) }}
      </p>
      <form v-if="can.write()" class="row" @submit.prevent="giftPlan">
        <select v-model="gift.planKey" class="select">
          <option v-for="plan in PLANS" :key="plan.key" :value="plan.key">贈送{{ plan.label }}方案</option>
        </select>
        <label class="field">
          結束時間（留空為不限）
          <input v-model="gift.endsAt" class="input" type="datetime-local" />
        </label>
        <input v-model="gift.reason" class="input" placeholder="原因，例如：Master Travel 客戶" required />
        <button class="button" type="submit">贈送</button>
      </form>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>內容</th>
              <th>開始</th>
              <th>結束</th>
              <th>原因</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in user.overrides" :key="item.id">
              <td>{{ item.planKey ? `方案：${PLAN_NAME[item.planKey] ?? item.planKey}` : `功能：${item.featureKey}` }}{{ item.active ? '（生效中）' : '' }}</td>
              <td>{{ dateTime(item.startsAt) }}</td>
              <td>{{ dateTime(item.endsAt) }}</td>
              <td>{{ item.reason }}</td>
              <td>
                <button v-if="item.active && can.write()" class="button secondary" @click="endOverride(item.id)">結束</button>
              </td>
            </tr>
            <tr v-if="user.overrides.length === 0">
              <td colspan="5" class="muted">沒有贈送</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>
