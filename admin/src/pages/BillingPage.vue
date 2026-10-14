<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { dateTime, fromLocalInput, PLAN_NAME } from '../format';

interface Feature {
  key: string;
  name: string;
  kind: 'SWITCH' | 'QUOTA';
}
interface Plan {
  key: string;
  name: string;
  isDefault: boolean;
  grants: Record<string, { enabled: boolean; quota: number | null }>;
}
interface Policy {
  id: string;
  name: string;
  planKey: string | null;
  featureKey: string | null;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  inEffect: boolean;
}
interface Catalogue {
  features: Feature[];
  plans: Plan[];
  policies: Policy[];
}

const data = ref<Catalogue | null>(null);
const error = ref('');
const message = ref('');
const policy = reactive({ kind: 'plan' as 'plan' | 'feature', name: '', planKey: 'company', featureKey: '', startsAt: '', endsAt: '' });

async function run(action: () => Promise<Catalogue>, done: string) {
  error.value = '';
  message.value = '';
  try {
    data.value = await action();
    message.value = done;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/** Empty quota means unlimited. */
function saveGrant(plan: Plan, feature: Feature, enabled: boolean, quotaText: string) {
  const quota = feature.kind === 'QUOTA' && quotaText.trim() !== '' ? Number(quotaText) : null;
  return run(
    () => api('PUT', `/billing/plans/${plan.key}/features/${feature.key}`, { enabled, quota }),
    `已更新「${plan.name}」的「${feature.name}」`,
  );
}

function createPolicy() {
  return run(
    () =>
      api('POST', '/billing/policies', {
        name: policy.name,
        ...(policy.kind === 'plan' ? { planKey: policy.planKey } : { featureKey: policy.featureKey }),
        startsAt: fromLocalInput(policy.startsAt),
        endsAt: fromLocalInput(policy.endsAt),
      }),
    '已建立',
  );
}

function setActive(item: Policy, active: boolean) {
  if (!active && !confirm(`確定停止「${item.name}」？停止後立即按各自的方案收費。`)) return;
  return run(() => api('PATCH', `/billing/policies/${item.id}`, { active }), active ? '已重新啟用' : '已停止');
}

function submitGrant(event: Event, plan: Plan, feature: Feature) {
  const form = event.target as HTMLFormElement;
  const enabled = (form.elements.namedItem('enabled') as HTMLInputElement).checked;
  const quota = feature.kind === 'QUOTA' ? (form.elements.namedItem('quota') as HTMLInputElement).value : '';
  return saveGrant(plan, feature, enabled, quota);
}

const grantOf = (plan: Plan, key: string) => plan.grants[key] ?? { enabled: false, quota: null };
const featureName = (key: string | null) => data.value?.features.find((feature) => feature.key === key)?.name ?? key;
const target = (item: Policy) =>
  item.planKey ? `全站享有「${PLAN_NAME[item.planKey] ?? item.planKey}」方案` : `「${featureName(item.featureKey)}」免費`;

onMounted(() => run(() => api('GET', '/billing'), ''));
</script>

<template>
  <h1>收費控制</h1>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <template v-if="data">
    <div class="card">
      <h2>全站免費期與限時免費</h2>
      <p class="hint">判斷順序：先看個別贈送，再看單一功能限時免費，最後在全站免費期、訂閱、預設方案三者中取最優惠者。</p>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>名稱</th>
              <th>內容</th>
              <th>開始</th>
              <th>結束</th>
              <th>狀態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in data.policies" :key="item.id">
              <td>{{ item.name }}</td>
              <td>{{ target(item) }}</td>
              <td>{{ dateTime(item.startsAt) }}</td>
              <td>{{ item.endsAt ? dateTime(item.endsAt) : '不限' }}</td>
              <td><span class="tag" :class="{ 'tag--info': item.inEffect }">{{ item.inEffect ? '生效中' : item.active ? '未到時間或已過期' : '已停止' }}</span></td>
              <td>
                <button v-if="item.active" class="button secondary" @click="setActive(item, false)">停止</button>
                <button v-else class="button secondary" @click="setActive(item, true)">重新啟用</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="row" @submit.prevent="createPolicy">
        <input v-model="policy.name" class="input" placeholder="名稱，例如：十月推廣" required />
        <select v-model="policy.kind" class="select">
          <option value="plan">全站享有方案</option>
          <option value="feature">單一功能免費</option>
        </select>
        <select v-if="policy.kind === 'plan'" v-model="policy.planKey" class="select">
          <option v-for="plan in data.plans" :key="plan.key" :value="plan.key">{{ plan.name }}</option>
        </select>
        <select v-else v-model="policy.featureKey" class="select" required>
          <option v-for="feature in data.features" :key="feature.key" :value="feature.key">{{ feature.name }}</option>
        </select>
        <label class="field">開始（留空為現在）<input v-model="policy.startsAt" class="input" type="datetime-local" /></label>
        <label class="field">結束（留空為不限）<input v-model="policy.endsAt" class="input" type="datetime-local" /></label>
        <button class="button" type="submit">新增</button>
      </form>
    </div>

    <div class="card table-wrap">
      <h2>方案內容</h2>
      <p class="hint">額度欄留空代表不限。修改後立即生效。</p>
      <table class="table">
        <thead>
          <tr>
            <th>功能</th>
            <th v-for="plan in data.plans" :key="plan.key">{{ plan.name }}{{ plan.isDefault ? '（預設）' : '' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="feature in data.features" :key="feature.key">
            <td>
              {{ feature.name }}
              <div class="hint">{{ feature.key }}</div>
            </td>
            <td v-for="plan in data.plans" :key="plan.key">
              <form class="row" @submit.prevent="(event) => submitGrant(event, plan, feature)">
                <label><input name="enabled" type="checkbox" :checked="grantOf(plan, feature.key).enabled" /> 可用</label>
                <input
                  v-if="feature.kind === 'QUOTA'"
                  name="quota"
                  class="input billing-page__quota"
                  type="number"
                  min="0"
                  placeholder="不限"
                  :value="grantOf(plan, feature.key).quota ?? ''"
                />
                <button class="button secondary" type="submit">儲存</button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
.billing-page__quota {
  width: 90px;
}
</style>
