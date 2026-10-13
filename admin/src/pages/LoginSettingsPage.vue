<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, can } from '../api';
import { dateTime } from '../format';

/**
 * 登入配置, laid out as Master Travel's 登入配置 (see docs/REUSE.md): one page with a tab per
 * kind of sign-in. MasterDriver has phone sign-in only: 開發模式登入, 簡訊登入 (the 253 accounts
 * for 國內 and 國際, and which provider each sends with) and Spug 推送助手, set up on its own.
 * Each tab is one card that saves as a whole.
 */

type Tab = 'development' | 'sms' | 'spug';
type Route = 'DOMESTIC' | 'INTERNATIONAL';
type Provider = 'SMS253' | 'SPUG';

interface DevelopmentStatus {
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

interface Channel {
  route: Route;
  provider: Provider;
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
  provider: Provider;
  countryCode: string;
  phone: string;
  purpose: string;
  status: string;
  providerCode: string | null;
  providerError: string | null;
  createdAt: string;
}

const ROUTE: Record<Route, { tab: string; numbers: string }> = {
  DOMESTIC: { tab: '國內簡訊', numbers: '+86 內地號碼' },
  INTERNATIONAL: { tab: '國際簡訊', numbers: '+852 香港、+853 澳門號碼' },
};
const PROVIDER: Record<Provider, { name: string; about: string }> = {
  SMS253: { name: '253 雲通訊', about: '用這個號碼區自己的 253 帳號，以我們報備的簽名和範本發送。' },
  SPUG: { name: 'Spug 推送助手', about: '用「Spug 推送助手」分頁的設定，以 Spug 的簽名和固定範本發送。' },
};

interface Spug {
  enabled: boolean;
  endpoint: string;
  appName: string;
  templateConfigured: boolean;
  testPhone: string;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
const SENT_STATUS: Record<string, string> = { sent: '已送出', rejected: '被拒絕', failed: '發送失敗' };

const route = useRoute();
const router = useRouter();
const TABS: Tab[] = ['development', 'sms', 'spug'];
const tab = ref<Tab>(TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'development');
watch(tab, (value) => void router.replace({ query: { ...route.query, tab: value } }));

const pageError = ref('');

// ------------------------------------------------------------ 開發模式登入

const development = ref<DevelopmentStatus | null>(null);
const devForm = reactive({ enabled: false, code: '' });
const devDirty = ref(false);
const devSaving = ref(false);
const devError = ref('');
const devSaved = ref('');
const codeValid = computed(() => devForm.code === '' || /^\d{6}$/.test(devForm.code));

function fillDevelopment(status: DevelopmentStatus) {
  development.value = status;
  devForm.enabled = status.enabled;
  devForm.code = '';
  devDirty.value = false;
}

function changeDevelopment() {
  devDirty.value = true;
  devSaved.value = '';
}

async function saveDevelopment() {
  if (!development.value || !devDirty.value || !codeValid.value) return;
  const turningOn = devForm.enabled && !development.value.enabled;
  if (turningOn && !confirm('開啟後，新的登入申請不會發簡訊，任何號碼都可用指定碼登入。只應在開發、測試或上架審核期間開啟。確定開啟？')) return;
  devSaving.value = true;
  devError.value = '';
  try {
    const body: { enabled?: boolean; code?: string } = {};
    if (devForm.enabled !== development.value.enabled) body.enabled = devForm.enabled;
    if (devForm.code) body.code = devForm.code;
    fillDevelopment(await api<DevelopmentStatus>('POST', '/settings/phone-login-development', body));
    devSaved.value = `已保存 ${new Date().toLocaleTimeString('zh-HK', { hour12: false })}`;
  } catch (e) {
    devError.value = (e as Error).message;
  } finally {
    devSaving.value = false;
  }
}

// --------------------------------------------------------------- 簡訊登入

const smsRoute = ref<Route>('DOMESTIC');
const channels = ref<Channel[]>([]);
const messages = ref<Message[]>([]);
const historyLoading = ref(false);
type ChannelForm = { provider: Provider; enabled: boolean; endpoint: string; account: string; password: string; template: string; testPhone: string };
const forms = reactive<Record<Route, ChannelForm>>({
  DOMESTIC: { provider: 'SMS253', enabled: false, endpoint: '', account: '', password: '', template: '', testPhone: '' },
  INTERNATIONAL: { provider: 'SMS253', enabled: false, endpoint: '', account: '', password: '', template: '', testPhone: '' },
});
const dirty = reactive<Record<Route, boolean>>({ DOMESTIC: false, INTERNATIONAL: false });
const smsAnyDirty = computed(() => dirty.DOMESTIC || dirty.INTERNATIONAL);
const smsSaving = ref(false);
const smsError = ref('');
const smsSaved = ref('');
const action = reactive({ loading: false, message: '' });

const channel = computed(() => channels.value.find((item) => item.route === smsRoute.value) ?? null);
const form = computed(() => forms[smsRoute.value]);

function fillChannels(list: Channel[], only?: Route) {
  channels.value = list;
  for (const item of list) {
    if (only && item.route !== only) continue;
    Object.assign(forms[item.route], {
      provider: item.provider,
      enabled: item.enabled,
      endpoint: item.endpoint,
      account: item.account,
      password: '',
      template: item.template,
      testPhone: item.testPhone,
    });
    dirty[item.route] = false;
  }
}

function changeSms() {
  dirty[smsRoute.value] = true;
  smsSaved.value = '';
}

/** Connection state as Master Travel shows it: 未配置, 正常, 連線失敗 or 未檢查. */
function stateOf(configured: boolean, lastStatus: string | null, lastMessage: string | null, lastAt: string | null, unchecked: string, missing: string) {
  if (!configured) return { key: 'not_configured', label: '未配置', message: missing };
  if (lastStatus === 'success') return { key: 'ok', label: '正常', message: `${lastMessage ?? ''}　${dateTime(lastAt)}` };
  if (lastStatus === 'error') return { key: 'error', label: '連線失敗', message: `${lastMessage ?? ''}　${dateTime(lastAt)}` };
  return { key: 'unknown', label: '未檢查', message: unchecked };
}

const status = computed(() => {
  const item = channel.value;
  if (!item) return { key: 'unknown', label: '未檢查', message: '載入中' };
  return stateOf(
    Boolean(item.endpoint && item.account && item.passwordConfigured),
    item.lastTestStatus,
    item.lastTestMessage,
    item.lastTestedAt,
    '按「檢查服務連線」查詢餘額，不會發出簡訊。',
    '填寫帳號和密碼後保存。',
  );
});

/** Whether the provider the route chose can send now; a route on a provider that is off sends nothing. */
const routeReady = computed(() => {
  const item = channel.value;
  if (!item) return true;
  if (form.value.provider === 'SPUG') return Boolean(spug.value?.enabled && spug.value.templateConfigured && spug.value.appName);
  return Boolean(form.value.enabled && item.account && item.passwordConfigured);
});

const routeMessages = computed(() => messages.value.filter((item) => item.route === smsRoute.value && item.provider === 'SMS253').slice(0, 10));
const spugMessages = computed(() => messages.value.filter((item) => item.provider === 'SPUG').slice(0, 10));

async function loadHistory() {
  historyLoading.value = true;
  try {
    messages.value = await api<Message[]>('GET', '/sms-messages');
  } catch (e) {
    smsError.value = (e as Error).message;
  } finally {
    historyLoading.value = false;
  }
}

async function saveSms() {
  smsSaving.value = true;
  smsError.value = '';
  try {
    for (const key of ['DOMESTIC', 'INTERNATIONAL'] as Route[]) {
      if (!dirty[key]) continue;
      fillChannels(await api<Channel[]>('PUT', `/sms-channels/${key}`, { ...forms[key] }), key);
    }
    smsSaved.value = `已保存 ${new Date().toLocaleTimeString('zh-HK', { hour12: false })}`;
  } catch (e) {
    smsError.value = (e as Error).message;
  } finally {
    smsSaving.value = false;
  }
}

function chooseProvider(provider: Provider) {
  if (form.value.provider === provider) return;
  form.value.provider = provider;
  changeSms();
}

function checkConnection() {
  const key = smsRoute.value;
  return runAction(async () => {
    const result = await api<{ message: string; channels: Channel[] }>('POST', `/sms-channels/${key}/test-connection`);
    channels.value = result.channels;
    return result.message;
  });
}

function sendTest() {
  const key = smsRoute.value;
  if (dirty[key]) {
    action.message = '請先保存簡訊設定，再發送測試簡訊';
    return;
  }
  if (!confirm('會真的發出一則簡訊到測試號碼（會產生費用）。確定發送？')) return;
  return runAction(async () => {
    const result = await api<{ status: string; providerError: string | null }>('POST', `/sms-channels/${key}/test-send`, {});
    await loadHistory();
    return result.status === 'sent' ? '測試簡訊已送出，請檢查手機' : `發送失敗：${result.providerError ?? result.status}`;
  });
}

async function runAction(task: () => Promise<string>) {
  action.loading = true;
  action.message = '';
  try {
    action.message = await task();
  } catch (e) {
    action.message = (e as Error).message;
  } finally {
    action.loading = false;
  }
}

watch(smsRoute, () => (action.message = ''));

// --------------------------------------------------------- Spug 推送助手

const spug = ref<Spug | null>(null);
const spugForm = reactive({ enabled: false, endpoint: '', appName: '', templateCode: '', testPhone: '' });
const spugDirty = ref(false);
const spugSaving = ref(false);
const spugError = ref('');
const spugSaved = ref('');
const spugAction = reactive({ loading: false, message: '' });

function fillSpug(value: Spug) {
  spug.value = value;
  Object.assign(spugForm, { enabled: value.enabled, endpoint: value.endpoint, appName: value.appName, templateCode: '', testPhone: value.testPhone });
  spugDirty.value = false;
}

function changeSpug() {
  spugDirty.value = true;
  spugSaved.value = '';
}

const spugStatus = computed(() => {
  const value = spug.value;
  if (!value) return { key: 'unknown', label: '未檢查', message: '載入中' };
  return stateOf(
    Boolean(value.appName && value.templateConfigured),
    value.lastTestStatus,
    value.lastTestMessage,
    value.lastTestedAt,
    'Spug 沒有不發簡訊的連線檢查，請用「發送測試簡訊」確認。',
    '填寫應用名稱和範本網址後保存。',
  );
});

/** The routes sending through Spug now, as saved. */
const spugRoutes = computed(() => channels.value.filter((item) => item.provider === 'SPUG').map((item) => ROUTE[item.route].tab));

async function saveSpug() {
  spugSaving.value = true;
  spugError.value = '';
  try {
    fillSpug(await api<Spug>('PUT', '/sms-spug', { ...spugForm }));
    spugSaved.value = `已保存 ${new Date().toLocaleTimeString('zh-HK', { hour12: false })}`;
  } catch (e) {
    spugError.value = (e as Error).message;
  } finally {
    spugSaving.value = false;
  }
}

async function sendSpugTest() {
  if (spugDirty.value) {
    spugAction.message = '請先保存 Spug 設定，再發送測試簡訊';
    return;
  }
  if (!confirm('會真的經 Spug 發出一則簡訊到測試號碼（會產生費用）。確定發送？')) return;
  spugAction.loading = true;
  spugAction.message = '';
  try {
    const result = await api<{ status: string; providerError: string | null; providerCode: string | null; spug: Spug }>('POST', '/sms-spug/test-send', {});
    fillSpug(result.spug);
    await loadHistory();
    spugAction.message = result.status === 'sent' ? '測試簡訊已送出，請檢查手機' : `發送失敗：${result.providerError ?? result.providerCode ?? result.status}`;
  } catch (e) {
    spugAction.message = (e as Error).message;
  } finally {
    spugAction.loading = false;
  }
}

onMounted(async () => {
  try {
    const [status, list, spugSetting] = await Promise.all([
      api<DevelopmentStatus>('GET', '/settings/phone-login-development'),
      api<Channel[]>('GET', '/sms-channels'),
      api<Spug>('GET', '/sms-spug'),
    ]);
    fillDevelopment(status);
    fillChannels(list);
    fillSpug(spugSetting);
    await loadHistory();
  } catch (e) {
    pageError.value = (e as Error).message;
  }
});
</script>

<template>
  <section class="login-settings-admin">
    <div class="login-settings-header">
      <span class="eyebrow">ACCESS &amp; AUTHENTICATION</span>
      <h2>登入配置</h2>
      <p class="section-desc">司機以手機號碼和簡訊驗證碼登入。這裡設定驗證碼怎樣發出，以及開發、測試和上架審核時使用的指定驗證碼。</p>
    </div>

    <div class="login-settings-scope">
      <span class="badge-internal">後端第三方接入配置</span>
      <strong>手機號碼登入</strong>
      <span>驗證碼依號碼自動分流：+86 走國內帳號，+852、+853 走國際帳號。開發模式登入開啟時不發簡訊。<template v-if="!can.superAdmin()">只有超級管理員可以修改。</template></span>
    </div>

    <div v-if="pageError" class="login-settings-page-error error-hint">{{ pageError }}</div>

    <div class="login-settings-tabs" role="tablist" aria-label="登入配置分類">
      <button type="button" role="tab" :aria-selected="tab === 'development'" :class="{ active: tab === 'development' }" @click="tab = 'development'">開發模式登入</button>
      <button type="button" role="tab" :aria-selected="tab === 'sms'" :class="{ active: tab === 'sms' }" @click="tab = 'sms'">簡訊登入</button>
      <button type="button" role="tab" :aria-selected="tab === 'spug'" :class="{ active: tab === 'spug' }" @click="tab = 'spug'">Spug 推送助手</button>
    </div>

    <!-- 開發模式登入 -->
    <section v-show="tab === 'development'" class="phone-login-development-settings login-settings-card" aria-labelledby="development-title">
      <div class="login-settings-card-header">
        <div>
          <span class="section-kicker">DEVELOPMENT ACCESS</span>
          <h3 id="development-title">開發模式登入</h3>
          <p>獨立控制手機號碼登入的開發驗證模式，不會修改簡訊設定。</p>
        </div>
        <span class="login-method-count">手機號碼</span>
      </div>
      <p v-if="!development && !pageError" class="phone-login-development-feedback">載入中</p>
      <template v-if="development">
        <div class="phone-login-development-grid">
          <label class="phone-login-development-toggle">
            <span>
              <strong>司機登入</strong>
              <small>開啟後，新的驗證碼申請不發簡訊，改為接受下面的指定驗證碼</small>
              <em :class="development.enabled ? 'is-enabled' : 'is-disabled'">{{ development.enabled ? '目前：開啟' : '目前：關閉' }}</em>
            </span>
            <input v-model="devForm.enabled" type="checkbox" :disabled="!can.superAdmin() || devSaving" @change="changeDevelopment" />
          </label>
          <label class="phone-login-development-code">
            <span>指定驗證碼</span>
            <input
              v-model="devForm.code"
              type="password"
              inputmode="numeric"
              maxlength="6"
              autocomplete="off"
              placeholder="輸入新的 6 位驗證碼；留空表示不變"
              :disabled="!can.superAdmin() || devSaving"
              @input="changeDevelopment"
            />
          </label>
        </div>
        <ul class="phone-login-development-rules">
          <li>開關在司機申請驗證碼的當下判斷；切換或更換指定碼，不影響已經發出的驗證碼。</li>
          <li>指定碼只以雜湊儲存，後台與 API 都不會顯示；首次預設為 000000，開啟前請先更換。</li>
          <li>申請頻率（「防濫用設定」）、10 分鐘有效期、5 次錯誤上限在開發模式下照常。</li>
        </ul>
        <div class="phone-login-development-actions">
          <p v-if="devError" class="phone-login-development-feedback error">{{ devError }}</p>
          <p v-else-if="!codeValid" class="phone-login-development-feedback error">指定驗證碼要是 6 位數字</p>
          <p v-else-if="devSaved" class="phone-login-development-feedback success">{{ devSaved }}</p>
          <p v-else-if="devDirty" class="phone-login-development-feedback">有未保存的修改</p>
          <p v-else class="phone-login-development-feedback">最後修改：{{ dateTime(development.updatedAt) }}　{{ development.updatedBy ?? '' }}</p>
          <button type="button" class="login-method-save" :disabled="!can.superAdmin() || !devDirty || devSaving || !codeValid" @click="saveDevelopment">
            {{ devSaving ? '保存中' : '保存開發模式設定' }}
          </button>
        </div>
      </template>
    </section>

    <!-- 簡訊登入: the 253 accounts, and which provider each number area sends with -->
    <div v-show="tab === 'sms'" class="login-settings-card sms-settings-card">
      <div class="login-settings-card-header">
        <div>
          <h3>簡訊登入</h3>
          <p>國內、國際各有自己的 253 雲通訊帳號，並各自選用 253 或 Spug 推送助手發送。切換發送服務商不會清空任何一家的設定。密碼加密儲存，後台不會顯示。</p>
        </div>
        <div v-if="channel" class="login-settings-card-meta">
          <span class="badge-internal">253 {{ smsRoute === 'DOMESTIC' ? 'Domestic' : 'International' }}</span>
          <label class="switch" :title="form.enabled ? '253 帳號已啟用' : '253 帳號未啟用'">
            <input v-model="form.enabled" type="checkbox" :disabled="!can.superAdmin()" @change="changeSms" />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="platform-tabs sms-platform-tabs" role="tablist" aria-label="簡訊帳號">
        <button v-for="(item, key) in ROUTE" :key="key" type="button" :class="{ active: smsRoute === key }" @click="smsRoute = key">
          {{ item.tab }}<span v-if="dirty[key]" class="platform-tab-dirty">未保存</span>
        </button>
      </div>

      <div v-if="channel" class="sms-sender">
        <div class="sms-sender-heading">
          <strong>發送服務商</strong>
          <small>{{ ROUTE[smsRoute].numbers }}的登入驗證碼由這裡選的服務商發出</small>
        </div>
        <div class="sms-provider-options" role="radiogroup" aria-label="發送服務商">
          <button
            v-for="(item, key) in PROVIDER"
            :key="key"
            type="button"
            role="radio"
            :aria-checked="form.provider === key"
            :class="{ active: form.provider === key }"
            :disabled="!can.superAdmin()"
            @click="chooseProvider(key)"
          >
            {{ item.name }}
          </button>
        </div>
        <small class="wechat-secret-help">{{ PROVIDER[form.provider].about }}</small>
        <p v-if="!routeReady" class="sms-sender-warning">
          {{
            form.provider === 'SPUG'
              ? 'Spug 推送助手尚未啟用或未填好設定，這個號碼區目前收不到驗證碼。'
              : '這個號碼區的 253 帳號尚未啟用或未填好，目前收不到驗證碼。'
          }}
          <button v-if="form.provider === 'SPUG'" type="button" class="link-button" @click="tab = 'spug'">前往 Spug 推送助手</button>
        </p>
      </div>

      <div class="sms-history">
        <div class="sms-history-header">
          <h4>最近發送紀錄（{{ ROUTE[smsRoute].tab }}・253）</h4>
          <button type="button" :disabled="historyLoading" @click="loadHistory">{{ historyLoading ? '載入中' : '重新整理紀錄' }}</button>
        </div>
        <div class="history-table">
          <table>
            <thead>
              <tr><th>發送時間</th><th>手機號</th><th>用途</th><th>狀態</th><th>服務商訊息</th></tr>
            </thead>
            <tbody>
              <tr v-if="!routeMessages.length"><td colspan="5">尚無發送紀錄</td></tr>
              <tr v-for="item in routeMessages" :key="item.id">
                <td>{{ dateTime(item.createdAt) }}</td>
                <td>{{ item.countryCode }} {{ item.phone }}</td>
                <td>{{ item.purpose === 'OTP' ? '登入驗證碼' : '測試' }}</td>
                <td>{{ SENT_STATUS[item.status] ?? item.status }}</td>
                <td>{{ [item.providerCode, item.providerError].filter(Boolean).join(' ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="wechat-secret-help">只記錄結果，不保存含驗證碼的簡訊內容。經 Spug 發出的紀錄在「Spug 推送助手」分頁。</p>
      </div>

      <div v-if="channel" class="sms-platform-panel">
        <div class="sms-status-panel" :class="'status-' + status.key">
          <div class="wechat-status-indicator"><span class="status-dot"></span><strong>{{ status.label }}</strong></div>
          <span>{{ status.message }}</span>
          <button type="button" class="secondary status-check-button" :disabled="action.loading || !can.superAdmin()" @click="checkConnection">
            {{ action.loading ? '檢查中' : '檢查服務連線' }}
          </button>
        </div>

        <div class="login-settings-form-grid sms-settings-grid">
          <label class="col-span-2">
            <span>API Host（接口網址）</span>
            <input v-model="form.endpoint" placeholder="https://" :disabled="!can.superAdmin()" @input="changeSms" />
          </label>
          <label>
            <span>API Account（帳號）</span>
            <input v-model="form.account" autocomplete="off" :disabled="!can.superAdmin()" @input="changeSms" />
          </label>
          <label>
            <span>API Password（密碼）</span>
            <input
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              :placeholder="channel.passwordConfigured ? '已配置則留空' : '必填'"
              :disabled="!can.superAdmin()"
              @input="changeSms"
            />
          </label>
          <label class="col-span-2">
            <span>簡訊範本</span>
            <textarea v-model="form.template" rows="3" maxlength="300" placeholder="必須包含 {code}" :disabled="!can.superAdmin()" @input="changeSms"></textarea>
          </label>
          <label>
            <span>測試手機號碼</span>
            <input v-model="form.testPhone" inputmode="numeric" placeholder="含國碼，只填數字，例如 85291234567" :disabled="!can.superAdmin()" @input="changeSms" />
          </label>
          <div class="sms-actions">
            <button type="button" :disabled="!can.superAdmin() || action.loading" @click="sendTest">用 253 發送測試簡訊</button>
            <span v-if="action.message">{{ action.message }}</span>
            <span v-else>最後修改：{{ dateTime(channel.updatedAt) }}　{{ channel.updatedBy ?? '' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-show="tab === 'sms'" class="login-settings-save-bar">
      <span v-if="smsError" class="error-hint">{{ smsError }}</span>
      <span v-else-if="smsSaved" class="success-hint">{{ smsSaved }}</span>
      <span v-else-if="smsAnyDirty" class="login-settings-note">有未保存的修改</span>
      <span v-else class="login-settings-note">簡訊設定已保存並由後端安全管理</span>
      <button type="button" class="primary" :disabled="!can.superAdmin() || smsSaving || !smsAnyDirty" @click="saveSms">{{ smsSaving ? '保存中' : '保存簡訊設定' }}</button>
    </div>

    <!-- Spug 推送助手: one setting for both number areas, kept apart from the 253 accounts -->
    <div v-show="tab === 'spug'" class="login-settings-card sms-settings-card">
      <div class="login-settings-card-header">
        <div>
          <span class="section-kicker">SPUG PUSH</span>
          <h3>Spug 推送助手</h3>
          <p>用 Spug 自己已報備的簽名和固定驗證碼範本代發，不用報備我們的公司；簡訊文字不能自訂。國內、國際共用這一份設定，在「簡訊登入」分頁選用 Spug 的號碼區才會經這裡發送。</p>
        </div>
        <div v-if="spug" class="login-settings-card-meta">
          <span class="badge-internal">Spug Push</span>
          <label class="switch" :title="spugForm.enabled ? '已啟用' : '未啟用'">
            <input v-model="spugForm.enabled" type="checkbox" :disabled="!can.superAdmin()" @change="changeSpug" />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div v-if="spug" class="sms-sender">
        <div class="sms-sender-heading">
          <strong>使用中的號碼區</strong>
          <small>在「簡訊登入」分頁的「發送服務商」選擇</small>
        </div>
        <div class="spug-routes">
          <span v-for="name in spugRoutes" :key="name" class="spug-route">{{ name }}</span>
          <span v-if="!spugRoutes.length" class="wechat-secret-help">目前沒有號碼區使用 Spug</span>
        </div>
      </div>

      <div class="sms-history">
        <div class="sms-history-header">
          <h4>最近發送紀錄（Spug）</h4>
          <button type="button" :disabled="historyLoading" @click="loadHistory">{{ historyLoading ? '載入中' : '重新整理紀錄' }}</button>
        </div>
        <div class="history-table">
          <table>
            <thead>
              <tr><th>發送時間</th><th>手機號</th><th>號碼區</th><th>用途</th><th>狀態</th><th>服務商訊息</th></tr>
            </thead>
            <tbody>
              <tr v-if="!spugMessages.length"><td colspan="6">尚無發送紀錄</td></tr>
              <tr v-for="item in spugMessages" :key="item.id">
                <td>{{ dateTime(item.createdAt) }}</td>
                <td>{{ item.countryCode }} {{ item.phone }}</td>
                <td>{{ ROUTE[item.route].tab }}</td>
                <td>{{ item.purpose === 'OTP' ? '登入驗證碼' : '測試' }}</td>
                <td>{{ SENT_STATUS[item.status] ?? item.status }}</td>
                <td>{{ [item.providerCode, item.providerError].filter(Boolean).join(' ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="spug" class="sms-platform-panel">
        <div class="sms-status-panel" :class="'status-' + spugStatus.key">
          <div class="wechat-status-indicator"><span class="status-dot"></span><strong>{{ spugStatus.label }}</strong></div>
          <span>{{ spugStatus.message }}</span>
        </div>

        <div class="login-settings-form-grid sms-settings-grid">
          <label class="col-span-2">
            <span>接口網址</span>
            <input v-model="spugForm.endpoint" placeholder="https://push.spug.cc" :disabled="!can.superAdmin()" @input="changeSpug" />
          </label>
          <label>
            <span>應用名稱（顯示在簡訊裡）</span>
            <input v-model="spugForm.appName" autocomplete="off" maxlength="60" placeholder="例如：跨境師傅幫" :disabled="!can.superAdmin()" @input="changeSpug" />
          </label>
          <label>
            <span>範本網址或編碼</span>
            <input
              v-model="spugForm.templateCode"
              type="password"
              autocomplete="new-password"
              :placeholder="spug.templateConfigured ? '已配置則留空' : '貼上範本的調用網址'"
              :disabled="!can.superAdmin()"
              @input="changeSpug"
            />
            <small class="wechat-secret-help">在 push.spug.cc 建立「短信 → 驗證碼」範本並選「動態推送對象」，把範本的調用網址貼到這裡；只保存其中的編碼，加密儲存。</small>
          </label>
          <label>
            <span>測試手機號碼</span>
            <input v-model="spugForm.testPhone" inputmode="numeric" placeholder="含國碼，只填數字，例如 8613800138000" :disabled="!can.superAdmin()" @input="changeSpug" />
          </label>
          <div class="sms-actions">
            <button type="button" :disabled="!can.superAdmin() || spugAction.loading" @click="sendSpugTest">用 Spug 發送測試簡訊</button>
            <span v-if="spugAction.message">{{ spugAction.message }}</span>
            <span v-else>最後修改：{{ dateTime(spug.updatedAt) }}　{{ spug.updatedBy ?? '' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-show="tab === 'spug'" class="login-settings-save-bar">
      <span v-if="spugError" class="error-hint">{{ spugError }}</span>
      <span v-else-if="spugSaved" class="success-hint">{{ spugSaved }}</span>
      <span v-else-if="spugDirty" class="login-settings-note">有未保存的修改</span>
      <span v-else class="login-settings-note">Spug 設定已保存並由後端安全管理</span>
      <button type="button" class="primary" :disabled="!can.superAdmin() || spugSaving || !spugDirty" @click="saveSpug">{{ spugSaving ? '保存中' : '保存 Spug 設定' }}</button>
    </div>
  </section>
</template>

<style src="../styles/login-settings.css"></style>
