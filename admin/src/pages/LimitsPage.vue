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
  dealBookingPerPhonePerDay: number;
  dealBookingPerIpPerDay: number;
  dealBookingPerDriverPerDay: number;
  otpResendSeconds: number;
  otpPerPhonePerHour: number;
  otpPerIpPerHour: number;
  updatedAt: string;
  updatedBy: string | null;
}

/** Each limit with what it is for, the range the API accepts, and what zero does. */
type Field = { key: keyof typeof form; label: string; hint: string; min: number; max: number };

const BOOKING_FIELDS: Field[] = [
  {
    key: 'bookingPerIpPerDay',
    label: '同一個 IP 每天最多送出幾筆預約',
    hint: '乘客在名片頁送出的預約，不含特價車。填 0 表示暫停所有名片頁的預約。',
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

/** 特價車 (2026-10-22): counted apart from 名片頁, mostly by phone, as many passengers share an address. */
const DEAL_FIELDS: Field[] = [
  {
    key: 'dealBookingPerPhonePerDay',
    label: '同一個乘客電話每天最多預約幾次特價車',
    hint: '所有特價車一起算。填 0 表示暫停所有特價車的預約。',
    min: 0,
    max: 100,
  },
  {
    key: 'dealBookingPerIpPerDay',
    label: '同一個 IP 每天最多送出幾筆特價車預約',
    hint: '只用來擋大量灌單。內地手機網絡很多人共用一個 IP，不要調得太低。',
    min: 0,
    max: 1000,
  },
  {
    key: 'dealBookingPerDriverPerDay',
    label: '每位司機的特價車每天最多收幾筆預約',
    hint: '一位司機所有特價車一起算。',
    min: 0,
    max: 5000,
  },
];

const OTP_FIELDS: Field[] = [
  {
    key: 'otpResendSeconds',
    label: '同一個號碼隔多少秒才能再申請驗證碼',
    hint: '司機按「重新發送」要等的時間。',
    min: 30,
    max: 600,
  },
  {
    key: 'otpPerPhonePerHour',
    label: '同一個號碼每小時最多申請幾次',
    hint: '超過後要等一小時。被人用來刷簡訊時可以調低。',
    min: 1,
    max: 20,
  },
  {
    key: 'otpPerIpPerHour',
    label: '同一個 IP 每小時最多申請幾次',
    hint: '同一個 Wi-Fi 或公司網絡下的人共用一個 IP，不要調得太低。',
    min: 1,
    max: 500,
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
  dealBookingPerPhonePerDay: 0,
  dealBookingPerIpPerDay: 0,
  dealBookingPerDriverPerDay: 0,
  otpResendSeconds: 60,
  otpPerPhonePerHour: 1,
  otpPerIpPerHour: 1,
});
const meta = ref<{ updatedAt: string; updatedBy: string | null } | null>(null);
const error = ref('');
const message = ref('');

function fill(limits: Limits) {
  for (const field of [...OTP_FIELDS, ...FIELDS, ...BOOKING_FIELDS, ...DEAL_FIELDS]) form[field.key] = limits[field.key];
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
  <div class="settings-page">
    <div class="page-head">
      <div>
        <h1>防濫用設定</h1>
        <p class="page-head__desc">這些上限用來擋住洗版和佔用儲存空間，正常使用不會碰到。修改後立即生效，不用重新部署；每次修改都會寫入操作紀錄。</p>
      </div>
    </div>
    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice">{{ message }}</div>

    <form class="card limits" @submit.prevent="save">
      <h2>簡訊驗證碼</h2>
      <div class="limits__fields">
        <label v-for="field in OTP_FIELDS" :key="field.key" class="field">
          {{ field.label }}
          <input v-model.number="form[field.key]" class="input" type="number" :min="field.min" :max="field.max" step="1" required />
          <span class="hint">{{ field.hint }}（可填 {{ field.min }} 到 {{ field.max }}）</span>
        </label>
      </div>
      <p class="hint">簡訊按則收費，這三項用來防止被刷。開發模式登入時同樣適用。</p>
      <h2 class="limits__heading">客服</h2>
      <div class="limits__fields">
        <label v-for="field in FIELDS" :key="field.key" class="field">
          {{ field.label }}
          <input v-model.number="form[field.key]" class="input" type="number" :min="field.min" :max="field.max" step="1" required />
          <span class="hint">{{ field.hint }}（可填 {{ field.min }} 到 {{ field.max }}）</span>
        </label>
      </div>
      <h2 class="limits__heading">名片頁預約</h2>
      <div class="limits__fields">
        <label v-for="field in BOOKING_FIELDS" :key="field.key" class="field">
          {{ field.label }}
          <input v-model.number="form[field.key]" class="input" type="number" :min="field.min" :max="field.max" step="1" required />
          <span class="hint">{{ field.hint }}（可填 {{ field.min }} 到 {{ field.max }}）</span>
        </label>
      </div>
      <h2 class="limits__heading">特價車預約</h2>
      <div class="limits__fields">
        <label v-for="field in DEAL_FIELDS" :key="field.key" class="field">
          {{ field.label }}
          <input v-model.number="form[field.key]" class="input" type="number" :min="field.min" :max="field.max" step="1" required />
          <span class="hint">{{ field.hint }}（可填 {{ field.min }} 到 {{ field.max }}）</span>
        </label>
      </div>
      <div class="form-foot">
        <button class="button" type="submit">儲存</button>
        <span v-if="meta?.updatedBy" class="hint">最後修改：{{ dateTime(meta.updatedAt) }}　{{ meta.updatedBy }}</span>
      </div>
    </form>

    <p class="hint">圖片與影片的大小上限（5 MB、25 MB）和保留天數（180 天）不在這裡設定：它們受雲端服務的限制，更改需要一併調整程式與儲存空間。</p>
  </div>
</template>

<style scoped>
.limits {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* A section starts below a line, like the save row. */
.limits__heading {
  margin-top: var(--space-md);
  padding-top: 20px;
  border-top: 1px solid var(--color-divider);
}

/* A section's fields side by side in even columns; the box sits at the top so the hints below line up. */
.limits__fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-lg) 20px;
  align-items: start;
}

.limits > .hint {
  margin: 0;
}
</style>
