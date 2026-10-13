<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import PlateTag from '../components/PlateTag.vue';
import RevealSelect, { revealLabel } from '../components/RevealSelect.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import { money, pickup, shortTime, type Money } from '../format';
import { t } from '../i18n';
import { toast } from '../toast';

interface Driver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  vehicleType: string | null;
  color: string | null;
  phone: string;
}

interface Detail {
  id: string;
  code: string;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  notes: string | null;
  dispatcherName: string | null;
  claimedAt: string | null;
  passengerConfirmedAt: string | null;
  viewer: 'dispatcher' | 'driver';
  passengerName: string | null;
  passengerContact: string | null;
  contactRevealAt: string | null;
  contactRevealMinutes?: number | null;
  driver: Driver | null;
  driverPrice: Money;
  passengerPrice?: Money;
  showPassengerPrice?: boolean;
  margin?: Money;
  serviceFee?: number | null;
  links?: { dispatch: string; passengerConfirm: string };
  share?: { dispatch: { wechat: string; whatsapp: string }; claimed: string | null; passenger: string };
}

const route = useRoute();
const id = String(route.params.id);
const order = ref<Detail | null>(null);
const error = ref('');
const busy = ref(false);
const justSent = route.query.sent === '1';
const editingPrices = ref(false);
const prices = reactive({ currency: 'HKD', driver: '', passenger: '' });

const isDispatcher = computed(() => order.value?.viewer === 'dispatcher');
const live = computed(() => order.value?.status === 'OPEN' || order.value?.status === 'ASSIGNED');

async function load() {
  try {
    order.value = await api<Detail>('GET', `/orders/${id}`);
    error.value = '';
  } catch (e) {
    error.value = errorText(e);
  }
}

async function act(path: string, done: string, confirmText?: string) {
  if (confirmText && !confirm(t(confirmText))) return;
  busy.value = true;
  try {
    order.value = await api<Detail>('POST', `/orders/${id}/${path}`);
    toast(done);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

const reveal = ref<number | null>(null);
const editingReveal = ref(false);

function editReveal() {
  reveal.value = order.value?.contactRevealMinutes ?? null;
  editingReveal.value = true;
}

async function saveReveal() {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id}/contact-reveal`, { contactRevealMinutes: reveal.value });
    editingReveal.value = false;
    toast('已更新');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function copy(text: string | undefined | null, done: string) {
  if (!text) return;
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

function editPrices() {
  const o = order.value;
  if (!o) return;
  prices.currency = o.driverPrice?.currency ?? o.passengerPrice?.currency ?? 'HKD';
  prices.driver = o.driverPrice ? String(o.driverPrice.amount) : '';
  prices.passenger = o.passengerPrice ? String(o.passengerPrice.amount) : '';
  editingPrices.value = true;
}

async function patchPrices(body: Record<string, unknown>, done: string) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id}/prices`, body);
    editingPrices.value = false;
    toast(done);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

function savePrices() {
  const money = (value: string) => (value ? { amount: Number(value), currency: prices.currency } : null);
  const body: Record<string, unknown> = { passengerPrice: money(prices.passenger) };
  // The driver price is fixed once a driver has taken the order.
  if (order.value?.status === 'OPEN') body.driverPrice = money(prices.driver);
  return patchPrices(body, '價格已更新');
}

onMounted(load);
</script>

<template>
  <div class="page">
    <RouterLink to="/app/orders" class="hint">← {{ t('我的單') }}</RouterLink>
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="order">
      <div v-if="justSent && isDispatcher" class="notice">✅ {{ t('單已發出。複製下面的文字貼到群裡，司機點連結就能搶。') }}</div>

      <section class="card">
        <div class="detail__top">
          <strong>{{ pickup(order.pickupAt) }}</strong>
          <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
        </div>
        <div class="detail__route">{{ t(order.origin) }} → {{ t(order.destination) }}</div>
        <p v-if="order.waypoints.length" class="muted">{{ t(`途經：${order.waypoints.join('、')}`) }}</p>
        <p class="muted">
          {{ t(`${order.passengers}人・${order.luggage}件行李`) }}<template v-if="order.vehicleType">・{{ t(order.vehicleType) }}</template>
        </p>
        <p v-if="order.notes">{{ t(`備註：${order.notes}`) }}</p>
      </section>

      <!-- Dispatcher: texts to paste into groups and to the passenger -->
      <section v-if="isDispatcher && order.share && live" class="card">
        <h2>{{ t('貼到群裡') }}</h2>
        <pre class="detail__share">{{ t(order.share.dispatch.wechat) }}</pre>
        <button class="button block large" type="button" @click="copy(order.share.dispatch.wechat, '已複製，貼到微信群吧')">{{ t('複製，貼到微信群') }}</button>
        <a v-if="!inWeChat" class="button secondary block detail__gap" :href="whatsappLink(t(order.share.dispatch.whatsapp))" target="_blank" rel="noopener">
          {{ t('分享到 WhatsApp') }}
        </a>
        <button class="button secondary block detail__gap" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
          {{ t('複製給乘客的確認訊息') }}
        </button>
        <button v-if="order.share.claimed" class="button secondary block detail__gap" type="button" @click="copy(order.share.claimed, '已複製，貼回群裡吧')">
          {{ t('複製「已派出」訊息貼回群') }}
        </button>
      </section>

      <!-- Prices: the dispatcher sees both and the spread; the driver only the driver price -->
      <section class="card">
        <h2>{{ t('價格') }}</h2>
        <template v-if="!editingPrices">
          <p>{{ t('司機價') }}：<strong>{{ money(order.driverPrice) || '—' }}</strong></p>
          <template v-if="isDispatcher">
            <p>{{ t('乘客價') }}：<strong>{{ money(order.passengerPrice) || '—' }}</strong>　<span class="hint">{{ order.showPassengerPrice ? t('乘客看得到') : t('乘客看不到') }}</span></p>
            <p v-if="order.margin">{{ t('差價') }}：<strong>{{ money(order.margin) }}</strong></p>
            <p v-if="order.serviceFee" class="hint">{{ t(`平台服務費 HK$${order.serviceFee}（取消會退回）`) }}</p>
            <div v-if="live" class="row">
              <button class="button secondary" type="button" @click="editPrices">{{ t('修改價格') }}</button>
              <button class="button secondary" type="button" :disabled="busy" @click="patchPrices({ showPassengerPrice: !order.showPassengerPrice }, '已更新')">
                {{ order.showPassengerPrice ? t('不讓乘客看到價格') : t('讓乘客看到價格') }}
              </button>
            </div>
          </template>
        </template>
        <form v-else @submit.prevent="savePrices">
          <label class="field">
            {{ t('幣種') }}
            <select v-model="prices.currency" class="select">
              <option value="HKD">HK$</option>
              <option value="CNY">RMB¥</option>
              <option value="MOP">MOP$</option>
            </select>
          </label>
          <label class="field">
            {{ t('司機價') }}
            <input v-model="prices.driver" class="input" type="number" min="0" step="0.01" :disabled="order.status !== 'OPEN'" />
            <span v-if="order.status !== 'OPEN'" class="hint">{{ t('已有司機接單，司機價不能再改') }}</span>
          </label>
          <label class="field">{{ t('乘客價') }}<input v-model="prices.passenger" class="input" type="number" min="0" step="0.01" /></label>
          <div class="row">
            <button class="button" type="submit" :disabled="busy">{{ t('儲存') }}</button>
            <button class="button secondary" type="button" @click="editingPrices = false">{{ t('取消') }}</button>
          </div>
        </form>
      </section>

      <section v-if="order.driver" class="card">
        <h2>{{ isDispatcher ? t('接單司機') : t('你的車') }}</h2>
        <p><strong>{{ order.driver.name ? t(order.driver.name) : '—' }}</strong>　<span class="hint">{{ t(`${shortTime(order.claimedAt)} 搶到`) }}</span></p>
        <PlateTag :hk="order.driver.hkPlate" :macau="order.driver.macauPlate" :mainland="order.driver.mainlandPlate" />
        <div v-if="isDispatcher" class="row detail__gap">
          <a class="button secondary" :href="`tel:${order.driver.phone.replace(/\s/g, '')}`">{{ t('致電司機') }}</a>
          <button class="button secondary" type="button" @click="copy(order.driver.phone, '已複製號碼')">{{ t('複製號碼') }}</button>
        </div>
      </section>

      <section class="card">
        <h2>{{ t('乘客') }}</h2>
        <p v-if="order.passengerContact">{{ order.passengerName ? t(order.passengerName) : t('乘客') }}：<strong>{{ order.passengerContact }}</strong></p>
        <p v-else class="notice">{{ t(`乘客電話將於 ${shortTime(order.contactRevealAt)} 顯示。之前如需安排，請聯絡派單者。`) }}</p>
        <div v-if="isDispatcher" class="detail__reveal">
          <template v-if="!editingReveal">
            <span class="hint">{{ t(`接單司機看到乘客電話：${revealLabel(order.contactRevealMinutes ?? null)}`) }}</span>
            <button v-if="live" class="chip" type="button" @click="editReveal">{{ t('修改') }}</button>
          </template>
          <template v-else>
            <RevealSelect v-model="reveal" />
            <div class="row">
              <button class="button" type="button" :disabled="busy" @click="saveReveal">{{ t('儲存') }}</button>
              <button class="button secondary" type="button" @click="editingReveal = false">{{ t('取消') }}</button>
            </div>
          </template>
        </div>
        <p class="hint">
          {{ order.passengerConfirmedAt ? t(`乘客已於 ${shortTime(order.passengerConfirmedAt)} 確認行程`) : t('乘客尚未確認') }}
        </p>
        <div v-if="order.passengerContact" class="row">
          <a class="button secondary" :href="`tel:${order.passengerContact.replace(/\s/g, '')}`">{{ t('致電乘客') }}</a>
          <button class="button secondary" type="button" @click="copy(order.passengerContact, '已複製')">{{ t('複製') }}</button>
        </div>
      </section>

      <section v-if="live" class="card row">
        <button v-if="order.status === 'ASSIGNED'" class="button" type="button" :disabled="busy" @click="act('complete', '已完成', '確定這趟行程已完成？')">{{ t('標記完成') }}</button>
        <template v-if="isDispatcher">
          <button v-if="order.status === 'ASSIGNED'" class="button secondary" type="button" :disabled="busy" @click="act('reopen', '已重新開放搶單', '收回這張單，重新讓司機搶？')">{{ t('改派') }}</button>
          <button class="button secondary" type="button" :disabled="busy" @click="act('cancel', '已取消', '確定取消這張單？')">{{ t('取消這張單') }}</button>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail__route {
  font-size: 18px;
  font-weight: 600;
  margin: var(--space-xs) 0;
}
.detail__share {
  white-space: pre-wrap;
  word-break: break-all;
  font: inherit;
  background: var(--color-background);
  border-radius: var(--radius-input);
  padding: var(--space-md);
  margin: 0 0 var(--space-md);
}
.detail__reveal {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-md);
}
.detail__gap {
  margin-top: var(--space-sm);
}
</style>
