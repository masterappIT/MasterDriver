<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, can } from '../api';
import { dateTime } from '../format';

type Provider = 'STRIPE' | 'ALIPAY_HK';
type Environment = 'sandbox' | 'production';

interface Channel {
  provider: Provider;
  environment: Environment;
  saved: boolean;
  enabled: boolean;
  publishableKey: string | null;
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  paymentMethods: string[];
  gatewayUrl: string | null;
  partner: string | null;
  appId: string | null;
  privateKeyConfigured: boolean;
  publicKeyConfigured: boolean;
  notifyUrl: string | null;
  returnUrl: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const METHODS: Record<string, string> = {
  card: '信用卡／扣帳卡',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  alipay: '支付寶',
  wechat_pay: '微信支付',
};
const ENV_LABEL: Record<Environment, string> = { sandbox: '測試（Sandbox）', production: '正式（Production）' };
const PATH: Record<Provider, string> = { STRIPE: 'stripe', ALIPAY_HK: 'alipay-hk' };

const channels = ref<Channel[]>([]);
const provider = ref<Provider>('STRIPE');
const environment = ref<Environment>('sandbox');
const error = ref('');
const message = ref('');
const busy = ref(false);
const stripe = reactive({ publishableKey: '', secretKey: '', webhookSecret: '', paymentMethods: ['card'] as string[] });
const alipay = reactive({ gatewayUrl: 'https://openapi.alipay.com', partner: '', appId: '', privateKey: '', publicKey: '', notifyUrl: '', returnUrl: '' });

const current = computed(() => channels.value.find((c) => c.provider === provider.value && c.environment === environment.value));

function fillForm() {
  const c = current.value;
  if (!c) return;
  Object.assign(stripe, { publishableKey: c.publishableKey ?? '', secretKey: '', webhookSecret: '', paymentMethods: c.paymentMethods.length ? [...c.paymentMethods] : ['card'] });
  Object.assign(alipay, {
    gatewayUrl: c.gatewayUrl ?? 'https://openapi.alipay.com',
    partner: c.partner ?? '',
    appId: c.appId ?? '',
    privateKey: '',
    publicKey: '',
    notifyUrl: c.notifyUrl ?? '',
    returnUrl: c.returnUrl ?? '',
  });
}

async function run<T extends { channels?: Channel[] } | Channel[]>(action: () => Promise<T>, done: (result: T) => string) {
  error.value = '';
  message.value = '';
  busy.value = true;
  try {
    const result = await action();
    channels.value = Array.isArray(result) ? result : (result.channels ?? channels.value);
    fillForm();
    message.value = done(result);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function select(p: Provider, env: Environment) {
  provider.value = p;
  environment.value = env;
  error.value = '';
  message.value = '';
  fillForm();
}

const save = () =>
  run(
    () => api<Channel[]>('PUT', `/payment-channels/${PATH[provider.value]}/${environment.value}`, provider.value === 'STRIPE' ? { ...stripe } : { ...alipay }),
    () => '已儲存。密鑰已加密，之後不會再顯示。',
  );

const test = () =>
  run(
    () => api<{ status: string; message: string; channels: Channel[] }>('POST', `/payment-channels/${PATH[provider.value]}/${environment.value}/test`),
    (result) => result.message,
  );

function toggle() {
  const c = current.value;
  if (!c) return;
  const next = !c.enabled;
  if (next && environment.value === 'production' && !confirm('啟用正式環境後，之後上線的線上付款會使用這組設定收款。確定啟用？')) return;
  return run(
    () => api<Channel[]>('POST', `/payment-channels/${PATH[provider.value]}/${environment.value}/${next ? 'enable' : 'disable'}`),
    () => (next ? '已啟用' : '已停用'),
  );
}

const statusText = (c: Channel) =>
  !c.saved ? '未設定' : c.enabled ? '已啟用' : c.lastTestStatus === 'success' || c.lastTestStatus === 'warning' ? '檢查通過，未啟用' : '已儲存，未檢查';

onMounted(() => run(() => api<Channel[]>('GET', '/payment-channels'), () => ''));
</script>

<template>
  <div class="settings-page">
    <h1>付款通道</h1>
    <div class="notice">
      沿用 Master Travel 的服務商：Stripe 與 AlipayHK。這裡只管理設定；訂閱與點數的線上付款會在之後接上，屆時使用「已啟用」的那組設定。
      <span v-if="!can.superAdmin()">只有超級管理員可以修改。</span>
    </div>
    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice">{{ message }}</div>

    <div class="grid">
      <button
        v-for="c in channels"
        :key="`${c.provider}-${c.environment}`"
        class="card channel-card"
        :class="{ 'channel-card--active': c.provider === provider && c.environment === environment }"
        type="button"
        @click="select(c.provider, c.environment)"
      >
        <strong>{{ c.provider === 'STRIPE' ? 'Stripe' : 'AlipayHK' }}</strong>
        <span class="muted">{{ ENV_LABEL[c.environment] }}</span>
        <span :class="{ 'channel-card__on': c.enabled }">{{ statusText(c) }}</span>
      </button>
    </div>

    <form v-if="current" class="card channel-form" @submit.prevent="save">
      <h2>{{ provider === 'STRIPE' ? 'Stripe' : 'AlipayHK' }}・{{ ENV_LABEL[environment] }}</h2>
      <fieldset :disabled="!can.superAdmin() || busy" class="channel-form__fields">
        <template v-if="provider === 'STRIPE'">
          <label class="field">Publishable key<input v-model="stripe.publishableKey" class="input" :placeholder="environment === 'production' ? 'pk_live_…' : 'pk_test_…'" required /></label>
          <label class="field">
            Secret key（{{ current.secretKeyConfigured ? '已加密儲存；留空表示不變' : '必填' }}）
            <input v-model="stripe.secretKey" class="input" type="password" autocomplete="off" :placeholder="environment === 'production' ? 'sk_live_… 或 rk_live_…' : 'sk_test_… 或 rk_test_…'" />
          </label>
          <label class="field">
            Webhook 簽章密鑰（{{ current.webhookSecretConfigured ? '已加密儲存；留空表示不變' : '選填，接上付款流程前需要' }}）
            <input v-model="stripe.webhookSecret" class="input" type="password" autocomplete="off" placeholder="whsec_…" />
          </label>
          <div class="field">
            付款方式
            <div class="row">
              <label v-for="(label, key) in METHODS" :key="key"><input v-model="stripe.paymentMethods" type="checkbox" :value="key" /> {{ label }}</label>
            </div>
          </div>
          <p class="hint channel-form__full">支付寶、微信支付在 Stripe 一般不支援自動續訂；會以「一次付一個月或一年」處理。</p>
        </template>
        <template v-else>
          <label class="field channel-form__full">支付網關（HTTPS）<input v-model="alipay.gatewayUrl" class="input" required /></label>
          <label class="field">商戶 ID（Partner）<input v-model="alipay.partner" class="input" inputmode="numeric" maxlength="16" placeholder="2160 開頭的 16 位數字" required /></label>
          <label class="field">App ID（選填）<input v-model="alipay.appId" class="input" /></label>
          <label class="field">
            應用私鑰 PKCS8 PEM（{{ current.privateKeyConfigured ? '已加密儲存；留空表示不變' : '必填' }}）
            <textarea v-model="alipay.privateKey" class="input channel-form__key" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field">
            支付寶公鑰 SPKI PEM（{{ current.publicKeyConfigured ? '已加密儲存；留空表示不變' : '必填' }}）
            <textarea v-model="alipay.publicKey" class="input channel-form__key" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field">異步通知地址（選填）<input v-model="alipay.notifyUrl" class="input" placeholder="https://" /></label>
          <label class="field">同步返回地址（選填）<input v-model="alipay.returnUrl" class="input" placeholder="https://" /></label>
          <p class="hint channel-form__full">和 Master Travel 一樣，AlipayHK 的「檢查」只驗證金鑰格式，不會呼叫 AlipayHK，不能證明可以實際收款。</p>
        </template>
        <div class="form-foot channel-form__full">
          <button class="button" type="submit">儲存</button>
          <button class="button secondary" type="button" :disabled="!current.saved" @click="test">{{ provider === 'STRIPE' ? '連線檢查' : '金鑰格式檢查' }}</button>
          <span class="hint">最後修改：{{ dateTime(current.updatedAt) }}　{{ current.updatedBy ?? '' }}</span>
          <span class="hint">最後檢查：{{ dateTime(current.lastTestedAt) }}　{{ current.lastTestMessage ?? '' }}</span>
          <!-- Turning a channel on or off is a different act from saving it: on the right, as on 平台服務費. -->
          <button class="button channel-form__toggle" :class="{ danger: current.enabled }" type="button" :disabled="!current.saved" @click="toggle">
            {{ current.enabled ? '停用' : '啟用' }}
          </button>
        </div>
      </fieldset>
    </form>
  </div>
</template>

<style scoped>
.channel-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  text-align: left;
  border: 2px solid transparent;
  font: inherit;
  cursor: pointer;
  margin-bottom: 0;
}

.channel-card--active {
  border-color: var(--color-primary);
}

.channel-card__on {
  color: var(--status-confirmed);
  font-weight: 600;
}

.channel-form {
  margin-top: var(--space-xl);
}

.channel-form__fields {
  border: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-lg) 20px;
  align-items: end;
}

/* Fields in two columns; notes, key boxes and the save row take the whole line. */
.channel-form__full,
.channel-form__fields > .field:has(textarea) {
  grid-column: 1 / -1;
}

.channel-form__fields > .hint {
  margin: 0;
}

.channel-form__toggle {
  margin-left: auto;
}

@media (max-width: 700px) {
  .channel-form__fields {
    grid-template-columns: minmax(0, 1fr);
  }
}

.channel-form__key {
  min-height: 90px;
  font-family: ui-monospace, monospace;
  font-size: var(--font-caption);
}
</style>
