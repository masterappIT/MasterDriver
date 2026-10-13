<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { dateTime, money } from '../format';

interface Status {
  enabled: boolean;
  fee: { amount: number; currency: string };
  updatedAt: string;
  updatedBy: string | null;
}

const status = ref<Status | null>(null);
const fee = ref('');
const error = ref('');
const message = ref('');

async function load() {
  status.value = await api<Status>('GET', '/billing/service-fee');
  fee.value = String(status.value.fee.amount);
}

async function save(body: { enabled?: boolean; fee?: number }, done: string) {
  error.value = '';
  message.value = '';
  try {
    status.value = await api<Status>('PUT', '/billing/service-fee', body);
    fee.value = String(status.value.fee.amount);
    message.value = done;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function toggle() {
  if (!status.value) return;
  const next = !status.value.enabled;
  if (next && !confirm(`開啟後，沒有免收資格的出單者每出一張單都會扣 ${money(status.value.fee)} 點數；點數不足就不能出單。確定開啟？`)) return;
  return save({ enabled: next }, next ? '已開啟平台服務費' : '已關閉平台服務費');
}

onMounted(() => load().catch((e) => (error.value = (e as Error).message)));
</script>

<template>
  <h1>平台服務費</h1>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <div v-if="status" class="card">
    <p>
      目前：<strong>{{ status.enabled ? '開啟' : '關閉' }}</strong>，每單 {{ money(status.fee) }}
    </p>
    <ul class="muted">
      <li>只向出單者收，接單司機永遠不收。</li>
      <li>出單時從點數扣，單被取消會全額退回；點數不足就不能出單。</li>
      <li>團隊、公司方案與全站免費期期間免收。</li>
    </ul>
    <form class="row" @submit.prevent="save({ fee: Number(fee) }, '金額已更新')">
      <label class="field">每單金額（HK$）<input v-model="fee" class="input" type="number" min="0" step="0.5" required /></label>
      <button class="button secondary" type="submit">更新金額</button>
      <button class="button" :class="{ danger: status.enabled }" type="button" @click="toggle">
        {{ status.enabled ? '關閉服務費' : '開啟服務費' }}
      </button>
    </form>
    <p class="hint">最後修改：{{ dateTime(status.updatedAt) }}　{{ status.updatedBy ?? '' }}</p>
  </div>
</template>
