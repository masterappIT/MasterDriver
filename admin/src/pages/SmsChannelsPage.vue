<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, can } from '../api';
import { dateTime } from '../format';

type Route = 'DOMESTIC' | 'INTERNATIONAL';

interface Channel {
  route: Route;
  enabled: boolean;
  endpoint: string;
  account: string;
  passwordConfigured: boolean;
  template: string;
  testPhone: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

interface Message {
  id: string;
  route: Route;
  countryCode: string;
  phone: string;
  purpose: string;
  status: string;
  providerCode: string | null;
  providerError: string | null;
  createdAt: string;
}

const ROUTE: Record<Route, { title: string; numbers: string }> = {
  DOMESTIC: { title: '國內帳號', numbers: '+86 內地號碼' },
  INTERNATIONAL: { title: '國際帳號', numbers: '+852 香港、+853 澳門號碼' },
};
const STATUS: Record<string, string> = { sent: '已送出', rejected: '被拒', failed: '失敗' };

const channels = ref<Channel[]>([]);
const messages = ref<Message[]>([]);
const forms = reactive<Record<Route, { endpoint: string; account: string; password: string; template: string; testPhone: string }>>({
  DOMESTIC: { endpoint: '', account: '', password: '', template: '', testPhone: '' },
  INTERNATIONAL: { endpoint: '', account: '', password: '', template: '', testPhone: '' },
});
const error = ref('');
const message = ref('');
const busy = ref(false);

function fill(list: Channel[]) {
  channels.value = list;
  for (const c of list) Object.assign(forms[c.route], { endpoint: c.endpoint, account: c.account, password: '', template: c.template, testPhone: c.testPhone });
}

async function run<T>(action: () => Promise<T>, done: (result: T) => string) {
  error.value = '';
  message.value = '';
  busy.value = true;
  try {
    const result = await action();
    const list = Array.isArray(result) ? (result as Channel[]) : (result as { channels?: Channel[] }).channels;
    if (list) fill(list);
    message.value = done(result);
    messages.value = await api<Message[]>('GET', '/sms-messages');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const save = (route: Route) => run(() => api<Channel[]>('PUT', `/sms-channels/${route}`, { ...forms[route] }), () => `${ROUTE[route].title}已儲存`);

const setEnabled = (route: Route, enabled: boolean) =>
  run(() => api<Channel[]>('PUT', `/sms-channels/${route}`, { enabled }), () => (enabled ? `${ROUTE[route].title}已啟用` : `${ROUTE[route].title}已停用`));

const testConnection = (route: Route) =>
  run(() => api<{ message: string; channels: Channel[] }>('POST', `/sms-channels/${route}/test-connection`), (r) => r.message);

function testSend(route: Route) {
  if (!confirm('會真的發出一則簡訊到測試號碼（會產生費用）。確定發送？')) return;
  return run(
    () => api<{ status: string; providerError: string | null }>('POST', `/sms-channels/${route}/test-send`, {}),
    (r) => (r.status === 'sent' ? '測試簡訊已送出，請檢查手機' : `發送失敗：${r.providerError ?? r.status}`),
  );
}

onMounted(() => run(() => api<Channel[]>('GET', '/sms-channels'), () => ''));
</script>

<template>
  <h1>簡訊通道</h1>
  <div class="notice">
    沿用 Master Travel 的 253 雲通訊。驗證碼依號碼自動分流：+86 走國內帳號，+852、+853 走國際帳號。開發模式登入開啟時不會發簡訊。
    <span v-if="!can.superAdmin()">只有超級管理員可以修改。</span>
  </div>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>

  <form v-for="c in channels" :key="c.route" class="card sms-form" @submit.prevent="save(c.route)">
    <h2>
      {{ ROUTE[c.route].title }}<span class="muted">（{{ ROUTE[c.route].numbers }}）</span>
      <span :class="c.enabled ? 'sms-form__on' : 'muted'">{{ c.enabled ? '已啟用' : '未啟用' }}</span>
    </h2>
    <fieldset :disabled="!can.superAdmin() || busy" class="sms-form__fields">
      <label class="field">接口網址<input v-model="forms[c.route].endpoint" class="input" placeholder="https://" /></label>
      <div class="row">
        <label class="field">帳號<input v-model="forms[c.route].account" class="input" autocomplete="off" /></label>
        <label class="field">
          密碼（{{ c.passwordConfigured ? '已加密儲存；留空表示不變' : '必填' }}）
          <input v-model="forms[c.route].password" class="input" type="password" autocomplete="off" />
        </label>
        <label class="field">測試號碼（含國碼，只填數字）<input v-model="forms[c.route].testPhone" class="input" inputmode="numeric" /></label>
      </div>
      <label class="field">簡訊範本（必須包含 {code}）<input v-model="forms[c.route].template" class="input" maxlength="300" /></label>
      <div class="row">
        <button class="button" type="submit">儲存</button>
        <button class="button secondary" type="button" @click="testConnection(c.route)">連線檢查（查餘額）</button>
        <button class="button secondary" type="button" @click="testSend(c.route)">發送測試簡訊</button>
        <button class="button" :class="{ danger: c.enabled }" type="button" @click="setEnabled(c.route, !c.enabled)">{{ c.enabled ? '停用' : '啟用' }}</button>
      </div>
    </fieldset>
    <p class="hint">
      最後檢查：{{ dateTime(c.lastTestedAt) }}　{{ c.lastTestMessage ?? '' }}<br />
      最後修改：{{ dateTime(c.updatedAt) }}　{{ c.updatedBy ?? '' }}
    </p>
  </form>

  <div class="card table-wrap">
    <h2>最近 100 則發送紀錄</h2>
    <p class="hint">只記錄結果，不保存含驗證碼的簡訊內容。</p>
    <table class="table">
      <thead>
        <tr>
          <th>時間</th>
          <th>帳號</th>
          <th>號碼</th>
          <th>用途</th>
          <th>結果</th>
          <th>253 回應</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in messages" :key="m.id">
          <td class="nowrap">{{ dateTime(m.createdAt) }}</td>
          <td>{{ ROUTE[m.route].title }}</td>
          <td class="nowrap">{{ m.countryCode }} {{ m.phone }}</td>
          <td>{{ m.purpose === 'OTP' ? '登入驗證碼' : '測試' }}</td>
          <td>{{ STATUS[m.status] ?? m.status }}</td>
          <td class="hint">{{ [m.providerCode, m.providerError].filter(Boolean).join(' ') }}</td>
        </tr>
        <tr v-if="messages.length === 0">
          <td colspan="6" class="muted">還沒有發送紀錄</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.sms-form__fields {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.sms-form h2 {
  display: flex;
  gap: var(--space-md);
  align-items: baseline;
}

.sms-form__on {
  color: var(--status-confirmed);
  font-size: var(--font-label);
}
</style>
