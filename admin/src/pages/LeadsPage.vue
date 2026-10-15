<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import { dateTime, hkd, PLAN_NAME } from '../format';
import { useListQuery } from '../list-query';

type LeadStatus = 'NEW' | 'CONTACTED' | 'INTERESTED' | 'CONVERTED' | 'NOT_INTERESTED';

interface Lead {
  userId: string;
  name: string | null;
  phone: string;
  status: LeadStatus;
  note: string;
  leadUpdatedAt: string | null;
  stats: { orders: number; completed: number; drivers: number; activeDays: number; growth: number; toppedUp: number; plan: string | null };
  score: number;
  scoreParts: Record<string, number>;
}

const STATUS: Record<LeadStatus, string> = {
  NEW: '未跟進',
  CONTACTED: '已聯絡',
  INTERESTED: '有興趣',
  CONVERTED: '已轉為 Master Travel 客戶',
  NOT_INTERESTED: '暫無意向',
};
const PART: Record<string, string> = { orders: '單量', drivers: '司機數×3', activeDays: '活躍天數×2', growth: '成長×2', paying: '付費' };

const leads = ref<Lead[] | null>(null);
const editing = ref<string | null>(null);
const draft = ref<{ status: LeadStatus; note: string }>({ status: 'NEW', note: '' });
const error = ref('');

// The period and the follow-up state stay in the address, like every list.
const list = useListQuery({ days: '30', status: '' }, (query) => void load(query));
const { filters } = list;

async function load(query: { days: string; status: string } = filters) {
  error.value = '';
  try {
    const params = new URLSearchParams({ days: query.days, ...(query.status ? { status: query.status } : {}) });
    leads.value = (await api<{ items: Lead[] }>('GET', `/leads?${params}`)).items;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function edit(lead: Lead) {
  editing.value = lead.userId;
  draft.value = { status: lead.status, note: lead.note };
}

async function save(lead: Lead) {
  try {
    await api('PUT', `/leads/${lead.userId}`, draft.value);
    editing.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const breakdown = (lead: Lead) =>
  Object.entries(lead.scoreParts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${PART[key] ?? key}：${value}`);

</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-head__title">
        <h1>潛在客戶</h1>
        <span v-if="leads" class="muted">共 {{ leads.length }} 位</span>
      </div>
      <p class="page-head__desc">按派單量、帶動的司機數、活躍天數、成長和付費情況排名，找出最可能需要 Master Travel 的車隊。</p>
    </div>
  </div>
  <div class="filters">
    <select v-model="filters.days" class="select" aria-label="期間" @change="list.apply()">
      <option value="14">近 14 天</option>
      <option value="30">近 30 天</option>
      <option value="90">近 90 天</option>
    </select>
    <select v-model="filters.status" class="select" aria-label="跟進狀態" @change="list.apply()">
      <option value="">全部跟進狀態</option>
      <option v-for="(label, key) in STATUS" :key="key" :value="key">{{ label }}</option>
    </select>
  </div>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>#</th>
          <th>出單者</th>
          <th>分數</th>
          <th class="num">單量／完成</th>
          <th class="num">司機數</th>
          <th class="num">活躍天數</th>
          <th class="num">成長</th>
          <th>付費</th>
          <th>跟進</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(lead, index) in leads ?? []" :key="lead.userId">
          <td>{{ index + 1 }}</td>
          <td class="nowrap">
            <RouterLink :to="`/users/${lead.userId}`">{{ lead.name ?? '未填姓名' }}</RouterLink>
            <div class="hint">{{ lead.phone }}</div>
          </td>
          <td class="nowrap">
            <strong>{{ lead.score }}</strong>
            <div v-for="part in breakdown(lead)" :key="part" class="hint">{{ part }}</div>
          </td>
          <td class="num">{{ lead.stats.orders }} / {{ lead.stats.completed }}</td>
          <td class="num">{{ lead.stats.drivers }}</td>
          <td class="num">{{ lead.stats.activeDays }}</td>
          <td class="num">{{ lead.stats.growth > 0 ? `+${lead.stats.growth}` : lead.stats.growth }}</td>
          <td class="nowrap">
            {{ lead.stats.plan ? PLAN_NAME[lead.stats.plan] ?? lead.stats.plan : '' }}
            {{ lead.stats.toppedUp > 0 ? `充值 ${hkd(lead.stats.toppedUp)}` : '' }}
            <span v-if="!lead.stats.plan && lead.stats.toppedUp === 0" class="muted">—</span>
          </td>
          <td class="wide">
            <template v-if="editing === lead.userId">
              <select v-model="draft.status" class="select">
                <option v-for="(label, key) in STATUS" :key="key" :value="key">{{ label }}</option>
              </select>
              <textarea v-model="draft.note" class="input leads-page__note" maxlength="2000" placeholder="跟進備註" />
              <div class="row">
                <button class="button" @click="save(lead)">儲存</button>
                <button class="button secondary" @click="editing = null">取消</button>
              </div>
            </template>
            <template v-else>
              <div>{{ STATUS[lead.status] }}</div>
              <div class="hint">{{ lead.note }}</div>
              <div v-if="lead.leadUpdatedAt" class="hint">{{ dateTime(lead.leadUpdatedAt) }}</div>
              <button class="button secondary" @click="edit(lead)">更新</button>
            </template>
          </td>
        </tr>
        <tr v-if="leads?.length === 0">
          <td colspan="9" class="muted">這段期間沒有派單紀錄</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.leads-page__note {
  width: 100%;
  min-height: 70px;
  margin: var(--space-sm) 0;
}
</style>
