<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, can } from '../api';
import { dateTime } from '../format';

interface Status {
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

const status = ref<Status | null>(null);
const code = ref('');
const error = ref('');
const message = ref('');

async function save(body: { enabled?: boolean; code?: string }, done: string) {
  error.value = '';
  message.value = '';
  try {
    status.value = await api<Status>('POST', '/settings/phone-login-development', body);
    code.value = '';
    message.value = done;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function toggle() {
  if (!status.value) return;
  const next = !status.value.enabled;
  if (next && !confirm('開啟後，新的登入申請不會發簡訊，任何號碼都可用指定碼登入。只應在開發、測試或上架審核期間開啟。確定開啟？')) return;
  return save({ enabled: next }, next ? '已開啟開發模式登入' : '已關閉，新的登入申請會發簡訊');
}

onMounted(async () => {
  try {
    status.value = await api<Status>('GET', '/settings/phone-login-development');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <h1>登入配置：開發模式登入</h1>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <div v-if="status" class="card">
    <div class="notice" :class="{ warning: status.enabled }">
      目前：<strong>{{ status.enabled ? '開啟' : '關閉' }}</strong>
      <span v-if="status.enabled">——新的登入申請不發簡訊，接受指定碼。</span>
    </div>
    <ul class="muted">
      <li>開關在司機申請驗證碼的當下判斷；切換或更換指定碼，不影響已經發出的驗證碼。</li>
      <li>指定碼只以雜湊儲存，後台與 API 都不會顯示；首次預設為 000000，開啟前請先更換。</li>
      <li>頻率限制、有效期、錯誤次數上限在開發模式下照常。</li>
    </ul>
    <template v-if="can.superAdmin()">
      <form class="row" @submit.prevent="save({ code }, '指定碼已更換')">
        <input v-model="code" class="input" inputmode="numeric" pattern="\d{6}" maxlength="6" placeholder="新的 6 位指定碼" required />
        <button class="button secondary" type="submit">更換指定碼</button>
        <button class="button" :class="{ danger: status.enabled }" type="button" @click="toggle">
          {{ status.enabled ? '關閉開發模式' : '開啟開發模式' }}
        </button>
      </form>
    </template>
    <p v-else class="muted">只有超級管理員可以修改。</p>
    <p class="hint">最後修改：{{ dateTime(status.updatedAt) }}　{{ status.updatedBy ?? '' }}</p>
  </div>
</template>
