<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { dateTime } from '../format';

interface Limits {
  supportGuestMediaPerDay: number;
  supportUserMediaPerDay: number;
  supportMessagesPerMinute: number;
  supportGuestConversationsPerIpPerDay: number;
  bookingPerIpPerDay: number;
  bookingPerPagePerDay: number;
  updatedAt: string;
  updatedBy: string | null;
}

/** Each limit with what it is for, the range the API accepts, and what zero does. */
type Field = { key: keyof typeof form; label: string; hint: string; min: number; max: number };

const BOOKING_FIELDS: Field[] = [
  {
    key: 'bookingPerIpPerDay',
    label: '同一個 IP 每天最多送出幾筆預約',
    hint: '乘客在名片頁送出的預約。填 0 表示暫停所有名片頁的預約。',
    min: 0,
    max: 100,
  },
  {
    key: 'bookingPerPagePerDay',
    label: '每個名片頁每天最多收幾筆預約',
    hint: '超過後乘客會看到「今天的預約已滿」。填 0 表示暫停所有名片頁的預約。',
    min: 0,
    max: 1000,
  },
];

const FIELDS: Field[] = [
  {
    key: 'supportMessagesPerMinute',
    label: '每個對話每分鐘最多幾則訊息',
    hint: '用戶和訪客都適用；客服人員的回覆不受限。',
    min: 1,
    max: 120,
  },
  {
    key: 'supportUserMediaPerDay',
    label: '用戶每天最多傳幾個圖片或影片',
    hint: '以 24 小時計。填 0 表示用戶只能傳文字。',
    min: 0,
    max: 500,
  },
  {
    key: 'supportGuestMediaPerDay',
    label: '訪客每天最多傳幾張圖片',
    hint: '訪客不能傳影片。填 0 表示訪客只能傳文字。',
    min: 0,
    max: 200,
  },
  {
    key: 'supportGuestConversationsPerIpPerDay',
    label: '同一個 IP 每天最多開幾個訪客對話',
    hint: '填 0 表示未登入的人不能開始新的客服對話（已有的訪客對話不受影響）。',
    min: 0,
    max: 100,
  },
];

const form = reactive({
  supportGuestMediaPerDay: 0,
  supportUserMediaPerDay: 0,
  supportMessagesPerMinute: 1,
  supportGuestConversationsPerIpPerDay: 0,
  bookingPerIpPerDay: 0,
  bookingPerPagePerDay: 0,
});
const meta = ref<{ updatedAt: string; updatedBy: string | null } | null>(null);
const error = ref('');
const message = ref('');

function fill(limits: Limits) {
  for (const field of [...FIELDS, ...BOOKING_FIELDS]) form[field.key] = limits[field.key];
  meta.value = { updatedAt: limits.updatedAt, updatedBy: limits.updatedBy };
}

async function save() {
  error.value = '';
  message.value = '';
  try {
    fill(await api<Limits>('PUT', '/settings/limits', { ...form }));
    message.value = '已儲存，立即生效';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  try {
    fill(await api<Limits>('GET', '/settings/limits'));
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <h1>防濫用設定</h1>
  <p class="muted">這些上限用來擋住洗版和佔用儲存空間，正常使用不會碰到。修改後立即生效，不用重新部署；每次修改都會寫入操作紀錄。</p>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>

  <form class="card limits" @submit.prevent="save">
    <h2>客服</h2>
    <label v-for="field in FIELDS" :key="field.key" class="field">
      {{ field.label }}
      <input v-model.number="form[field.key]" class="input limits__input" type="number" :min="field.min" :max="field.max" step="1" required />
      <span class="hint">{{ field.hint }}（可填 {{ field.min }} 到 {{ field.max }}）</span>
    </label>
    <h2 class="limits__heading">名片頁預約</h2>
    <label v-for="field in BOOKING_FIELDS" :key="field.key" class="field">
      {{ field.label }}
      <input v-model.number="form[field.key]" class="input limits__input" type="number" :min="field.min" :max="field.max" step="1" required />
      <span class="hint">{{ field.hint }}（可填 {{ field.min }} 到 {{ field.max }}）</span>
    </label>
    <div class="row">
      <button class="button" type="submit">儲存</button>
      <span v-if="meta?.updatedBy" class="hint">最後修改：{{ dateTime(meta.updatedAt) }}　{{ meta.updatedBy }}</span>
    </div>
  </form>

  <p class="hint">圖片與影片的大小上限（5 MB、25 MB）和保留天數（180 天）不在這裡設定：它們受雲端服務的限制，更改需要一併調整程式與儲存空間。</p>
</template>

<style scoped>
.limits {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  max-width: 560px;
}

.limits__heading {
  margin-top: var(--space-lg);
}

.limits__input {
  max-width: 160px;
}
</style>
