<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import { SEAT_STATUS, partyRoute, type CarpoolCar, type CarpoolTrip, type SeatStatus } from '../carpool';
import CarpoolCarCard from '../components/CarpoolCar.vue';
import ContactLines from '../components/ContactLines.vue';
import PoolRadar from '../components/PoolRadar.vue';
import TonePill from '../components/TonePill.vue';
import { copyText } from '../device';
import { loadLine, money, pickup, shortTime, type Money } from '../format';
import { t } from '../i18n';
import { PAYMENT_KINDS, type PassengerPayment } from '../payment';
import { toast } from '../toast';

interface SeatView extends CarpoolTrip {
  seat: {
    code: string;
    status: SeatStatus;
    passengers: number;
    luggage: number;
    pickupPoint: string;
    dropoff: string;
    passengerName: string;
    notes: string | null;
    price: Money;
    expiresAt: string | null;
    reconfirm: boolean;
    confirmedAt: string | null;
    cancelledAt: string | null;
    progress: { departedAt: string | null; arrivedAt: string | null; pickedUpAt: string | null; noShowAt: string | null; droppedAt: string | null };
    canCancel: boolean;
  };
  orderStatus: string | null;
  arranging: boolean;
  driver: CarpoolCar | null;
  organizer: { name: string | null; phones: string[]; wechatId: string | null; whatsapp: string | null } | null;
  payment: PassengerPayment | null;
}

/** A 拼車 passenger's own link: their seats, the driver once confirmed, how the trip goes, and how to pay. */
const POLL_MS = 15_000;
const route = useRoute();
const code = String(route.params.code);
const justSent = route.query.sent === '1';
const view = ref<SeatView | null>(null);
const error = ref('');
const busy = ref(false);
let poller: ReturnType<typeof setInterval> | undefined;

const live = computed(() => {
  const v = view.value;
  return Boolean(v && (v.seat.status === 'PENDING' || v.seat.status === 'CONFIRMED') && v.status !== 'CANCELLED' && v.orderStatus !== 'COMPLETED' && v.orderStatus !== 'CANCELLED');
});
const cancelled = computed(() => view.value?.status === 'CANCELLED' || view.value?.orderStatus === 'CANCELLED');

/** Where the passenger's part of the trip is, newest step first. */
const progressText = computed(() => {
  const p = view.value?.seat.progress;
  if (!p) return '';
  const time = (iso: string) => shortTime(iso).split(' ')[1] ?? '';
  if (p.droppedAt) return `${time(p.droppedAt)} 已下車`;
  if (p.pickedUpAt) return `${time(p.pickedUpAt)} 已上車`;
  if (p.noShowAt) return `司機 ${time(p.noShowAt)} 標記你沒有出現，請盡快聯絡司機`;
  if (p.arrivedAt) return `司機 ${time(p.arrivedAt)} 已到你的上車點`;
  if (p.departedAt) return `司機 ${time(p.departedAt)} 已出發`;
  return '';
});

const tone = computed(() => {
  const status = view.value?.seat.status;
  if (status === 'PENDING') return 'waiting' as const;
  if (status === 'CONFIRMED') return cancelled.value ? ('closed' as const) : ('done' as const);
  return 'closed' as const;
});

async function load() {
  try {
    view.value = await api<SeatView>('GET', `/public/carpool-seats/${code}`);
    error.value = '';
  } catch (e) {
    if (!view.value) error.value = errorText(e);
  }
}

async function act(action: 'cancel' | 'reconfirm', question?: string) {
  if (question && !confirm(t(question))) return;
  busy.value = true;
  try {
    view.value = await api<SeatView>('POST', `/public/carpool-seats/${code}/${action}`);
    toast(action === 'cancel' ? '已取消報位' : '已接受新的安排');
  } catch (e) {
    toast(errorText(e));
    await load();
  } finally {
    busy.value = false;
  }
}

async function copyLink() {
  toast((await copyText(location.origin + location.pathname)) ? '已複製連結' : '複製失敗，請長按網址自行複製');
}

async function copyAccount(account: string) {
  toast((await copyText(account)) ? '已複製' : '複製失敗，請長按文字自行複製');
}

function refresh() {
  if (!document.hidden && !busy.value && live.value) void load();
}

onMounted(async () => {
  await load();
  poller = setInterval(refresh, POLL_MS);
  document.addEventListener('visibilitychange', refresh);
});
onBeforeUnmount(() => {
  clearInterval(poller);
  document.removeEventListener('visibilitychange', refresh);
});
</script>

<template>
  <div class="page">
    <h1>{{ t('我的拼車') }}</h1>
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="view">
      <div v-if="justSent" class="notice seat__sent">
        <span>{{ t('報位已送出。請保存這個頁面的連結，之後在這裡看司機、行程進度和付款方式。') }}</span>
        <button class="chip" type="button" @click="copyLink">{{ t('複製連結') }}</button>
      </div>

      <div v-if="cancelled" class="notice error">{{ t('司機取消了這趟拼車。如有疑問請聯絡司機。') }}</div>
      <div v-else-if="view.orderStatus === 'COMPLETED'" class="notice">{{ t('行程已完成，多謝乘搭。') }}</div>

      <section v-if="view.seat.status === 'PENDING' && !cancelled" class="card seat__waiting" role="status">
        <PoolRadar :size="64" />
        <div>
          <strong>{{ t('正在等司機確認') }}</strong>
          <p class="hint">{{ view.seat.expiresAt ? t(`司機 ${shortTime(view.seat.expiresAt)} 前沒有回覆，報位會失效。這一頁會自動更新。`) : '' }}</p>
        </div>
      </section>

      <section v-if="view.seat.reconfirm && live" class="card seat__reconfirm">
        <strong>{{ t('司機改了出發時間或價錢') }}</strong>
        <p>{{ t(`現在是 ${pickup(view.pickupAt)}，${view.seatPrice ? `每位 ${money(view.seatPrice)}` : '每位價錢請向司機查詢'}。接受的話請按下面的按鈕；不接受可以取消報位。`) }}</p>
        <button class="button block" type="button" :disabled="busy" @click="act('reconfirm')">{{ t('接受新的安排') }}</button>
      </section>

      <section class="card seat__trip">
        <TonePill :tone="tone">{{ t(SEAT_STATUS[view.seat.status].passenger) }}</TonePill>
        <strong class="seat__time">{{ pickup(view.pickupAt) }}</strong>
        <div class="seat__route">{{ t(`${view.origin} 至 ${view.destination}`) }}</div>
        <p class="seat__line">{{ t(partyRoute(view.seat, view.destination)) }}</p>
        <p class="seat__line">{{ t(loadLine(view.seat.passengers, view.seat.luggage)) }}{{ view.seat.price ? t(`｜${money(view.seat.price)}`) : '' }}</p>
        <p v-if="view.seat.status === 'CONFIRMED' && view.short > 0 && view.status !== 'ORDERED'" class="seat__short">
          {{ t(`還差 ${view.short} 位成行。人數不夠時，司機可能照樣出發、延後或取消，會再通知你。`) }}
        </p>
        <p v-if="progressText && live" class="seat__progress">{{ t(progressText) }}</p>
        <p class="hint seat__shared">{{ t('拼車：途中會接送其他乘客。') }}</p>
      </section>

      <section v-if="view.driver" class="card">
        <span class="section-label">{{ t('接送你的司機') }}</span>
        <CarpoolCarCard :car="view.driver" show-plates />
      </section>
      <section v-else-if="view.arranging && view.seat.status === 'CONFIRMED'" class="card">
        <span class="section-label">{{ t('接送你的司機') }}</span>
        <p class="muted">{{ t('司機安排中，安排好後這裡會顯示司機和車牌。') }}</p>
      </section>
      <section v-if="view.organizer" class="card">
        <span class="section-label">{{ t(`為你安排的人：${view.organizer.name ?? ''}`) }}</span>
        <ContactLines :phones="view.organizer.phones" :wechat-id="view.organizer.wechatId" :whatsapp="view.organizer.whatsapp" />
      </section>

      <section v-if="view.payment && live" class="card seat__pay">
        <span class="section-label">{{ view.payment.payee ? t(`付款給 ${view.payment.payee}`) : t('付款方式') }}</span>
        <strong v-if="view.payment.amount" class="seat__pay-amount">{{ money(view.payment.amount) }}</strong>
        <p v-if="view.payment.paid" class="seat__paid">{{ t('已確認收到你的付款') }}</p>
        <div v-for="method in view.payment.methods" :key="method.id" class="seat__method">
          <strong>{{ t(method.label) }}<span v-if="method.label !== PAYMENT_KINDS[method.kind].name" class="hint">　{{ t(PAYMENT_KINDS[method.kind].name) }}</span></strong>
          <img v-if="method.qrUrl" :src="method.qrUrl" :alt="t(`${method.label}收款碼`)" class="seat__qr" />
          <div v-if="method.account" class="seat__account">
            <span>{{ method.account }}</span>
            <button class="chip" type="button" @click="copyAccount(method.account)">{{ t('複製') }}</button>
          </div>
        </div>
      </section>

      <section v-if="view.cancelPolicy && live" class="card">
        <span class="section-label">{{ t('司機的取消規則') }}</span>
        <p class="seat__policy">{{ t(view.cancelPolicy) }}</p>
      </section>

      <p class="hint seat__note">{{ t('車費由你和司機自行約定並直接支付，平台不收款。') }}</p>

      <button v-if="view.seat.canCancel" class="seat__cancel" type="button" :disabled="busy" @click="act('cancel', '確定取消報位？')">
        {{ t('取消報位') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.seat__sent {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
}
.seat__waiting {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.seat__waiting strong {
  font-size: var(--font-body-large);
}
.seat__waiting .hint {
  margin: var(--space-xs) 0 0;
}
.seat__reconfirm {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.seat__reconfirm p {
  margin: var(--space-xs) 0 var(--space-md);
}
.seat__trip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.seat__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.seat__route {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.seat__line {
  margin: 0;
  color: var(--color-text-secondary);
}
.seat__short {
  margin: var(--space-xs) 0 0;
  color: var(--color-gold-ink);
}
.seat__progress {
  margin: var(--space-xs) 0 0;
  color: var(--color-primary-dark);
  font-weight: 700;
}
.seat__shared {
  margin: var(--space-xs) 0 0;
}
.seat__pay {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.seat__pay-amount {
  color: var(--color-gold-ink);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.seat__paid {
  margin: 0;
  color: var(--status-confirmed);
  font-weight: 700;
}
.seat__method {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  padding-top: var(--space-md);
  margin-top: var(--space-sm);
  border-top: 1px solid var(--color-divider);
}
.seat__qr {
  align-self: center;
  width: 200px;
  max-width: 100%;
  border-radius: var(--radius-input);
}
.seat__account {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  overflow-wrap: anywhere;
}
.seat__policy {
  margin: 0;
  white-space: pre-wrap;
}
.seat__note {
  text-align: center;
}
.seat__cancel {
  display: block;
  margin: 0 auto;
  min-height: 44px;
  padding: 0 var(--space-xl);
  border: none;
  background: none;
  color: var(--color-error);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
</style>
