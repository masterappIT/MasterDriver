<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import ContactLines from '../components/ContactLines.vue';
import PlateTag from '../components/PlateTag.vue';
import TripGroupJoin, { type TripGroup } from '../components/TripGroupJoin.vue';
import RoutePoints from '../components/RoutePoints.vue';
import { copyText } from '../device';
import { loadLine, money, pickup, plateKind, shortTime } from '../format';
import { progressLine, type TripProgress } from '../journey';
import { t } from '../i18n';
import { PAYMENT_KINDS, type PassengerPayment } from '../payment';
import { toast } from '../toast';
import type { PlateType } from '@masterdriver/shared/vehicle-plate';
import LinkProblem from '../components/LinkProblem.vue';

interface TripDriver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  plateType?: PlateType | null;
  vehicleType: string | null;
  color: string | null;
  phone: string | null;
  /** Every number of the driver: the first is `phone`, then their other side of the border. None once the leg is over. */
  phones: string[];
  /** The driver chose not to show their plates to passengers. */
  platesHidden?: boolean;
  /** The driver's vehicle photos, when they uploaded any. */
  photos: string[];
}

/** 接駁: one leg of the trip and its driver. The passenger is not told where the cars meet. */
interface TripLeg {
  legIndex: number;
  status: string;
  passengerConfirmedAt: string | null;
  driver: TripDriver | null;
  progress: TripProgress;
}

interface PassengerView {
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  passengerName: string | null;
  /** 航班號 the person who arranged the trip noted. */
  flightNo: string | null;
  /** 行程進度 of the leg under way, as its driver reported it. */
  progress: TripProgress;
  price: { amount: number; currency: string } | null;
  dispatcherName: string | null;
  /** Who arranged the trip and how to reach them; null when they are the driver. */
  dispatcher: {
    name: string | null;
    phone: string;
    phones: string[];
    wechatId: string | null;
    whatsapp: string | null;
    /** Their 名片頁, when public: the passenger books them directly next time. */
    pageCode: string | null;
  } | null;
  passengerConfirmedAt: string | null;
  /** 行程群: the group made for this trip, when the person who arranged it gave one. */
  tripGroup: TripGroup | null;
  driver: TripDriver | null;
  /** 接駁: the car changes on the way; `legs` then holds both legs and their drivers. */
  transfer?: boolean;
  legs: TripLeg[] | null;
  /** 收款: how to pay the dispatcher, when they chose to show it. */
  payment: PassengerPayment | null;
}

/** "13:50": the time of day only, for the driver's progress. */
const clock = (iso: string) => shortTime(iso).split(' ')[1] ?? '';

/** The passenger's page: no sign-in, no ads, never the driver price. */
const route = useRoute();
const confirmCode = String(route.params.confirmCode);
const trip = ref<PassengerView | null>(null);
const error = ref('');
const busy = ref(false);
const ended = ref<HTMLElement | null>(null);

async function load() {
  try {
    const before = trip.value?.status;
    trip.value = await api<PassengerView>('GET', `/c/${confirmCode}`);
    error.value = '';
    // The trip ended while the page was open: bring the passenger to the notice that says so.
    if (before && before !== 'COMPLETED' && trip.value.status === 'COMPLETED') {
      await nextTick();
      ended.value?.scrollIntoView({ block: 'start' });
      window.scrollTo(0, 0);
    }
  } catch (e) {
    // A failed refresh keeps what is on screen; only a first load that fails is an error.
    if (!trip.value) error.value = errorText(e);
  }
}

/**
 * The trip changes after the passenger opens the link (a driver takes it, the driver changes,
 * the fare is marked received), so the page reads it again every 10 seconds while it is on
 * screen and at once when the passenger comes back to it. Not once the trip is over.
 */
const REFRESH_MS = 10_000;
let timer: ReturnType<typeof setInterval> | undefined;

function refresh() {
  const status = trip.value?.status;
  if (document.visibilityState !== 'visible' || busy.value || status === 'COMPLETED' || status === 'CANCELLED') return;
  void load();
}

async function confirm() {
  busy.value = true;
  try {
    trip.value = await api<PassengerView>('POST', `/c/${confirmCode}/confirm`);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function copyAccount(account: string) {
  toast((await copyText(account)) ? '已複製' : '複製失敗，請長按文字自行複製');
}

onMounted(() => {
  void load();
  timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', refresh);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', refresh);
});
</script>

<template>
  <div class="page confirm-page">
    <LinkProblem v-if="error && !trip" :message="error" next="請聯絡為你安排行程的司機，取得新的連結。" />
    <div v-else-if="error" class="notice error">{{ error }}</div>
    <template v-if="trip">
      <h1 class="confirm-page__title">{{ trip.dispatcherName ? t(`${trip.dispatcherName} 為你安排的行程`) : t('你的行程') }}</h1>

      <div v-if="trip.status === 'CANCELLED'" class="notice error">{{ t('這個行程已取消，如有疑問請聯絡為你安排的司機。') }}</div>
      <div v-if="trip.status === 'COMPLETED'" ref="ended" class="confirm-page__ended">
        <strong>{{ t('行程已完成') }}</strong>
        <span class="confirm-page__ended-trip">{{ t(`${pickup(trip.pickupAt)}　${trip.origin} 至 ${trip.destination}`) }}</span>
        <span>{{ t('多謝乘搭。遺留物品或其他問題，請聯絡為你安排的人。') }}</span>
      </div>
      <p v-else-if="trip.passengerConfirmedAt" class="notice confirm-page__done">{{ t(`你已於 ${shortTime(trip.passengerConfirmedAt)} 確認行程。`) }}</p>

      <!-- A finished trip shows only that it is over and who arranged it. -->
      <template v-if="trip.status === 'COMPLETED'" />
      <!-- 接駁: one trip and one price; the passenger only needs to know the car changes on the way. -->
      <template v-else-if="trip.legs && trip.legs.length > 1">
        <section class="card">
          <div class="confirm-page__time">{{ pickup(trip.pickupAt) }}</div>
          <RoutePoints :origin="trip.origin" :destination="trip.destination" :waypoints="trip.waypoints" />
          <p class="confirm-page__load">{{ t(loadLine(trip.passengers, trip.luggage, trip.vehicleType)) }}</p>
          <p v-if="trip.flightNo" class="confirm-page__load">{{ t(`航班：${trip.flightNo}`) }}</p>
          <p class="confirm-page__transfer">{{ t('接駁行程：中途會換車，由兩位司機接送。') }}</p>
          <div v-if="trip.price" class="confirm-page__price"><span>{{ t('費用') }}</span><strong>{{ money(trip.price) }}</strong></div>
        </section>
        <template v-for="leg in trip.legs" :key="leg.legIndex">
          <section class="card">
            <p class="confirm-page__label">{{ leg.legIndex === 1 ? t('第 1 段司機（先接你的車）') : t('第 2 段司機（換車後的車）') }}</p>
            <p v-if="leg.status === 'ASSIGNED' && progressLine(leg.progress, clock)" class="confirm-page__progress">{{ t(progressLine(leg.progress, clock)) }}</p>
            <div v-if="leg.driver" class="confirm-page__driver">
              <strong>{{ leg.driver.name ? t(leg.driver.name) : t('司機') }}</strong>
              <span class="muted">{{ [leg.driver.vehicleType, leg.driver.color, plateKind(leg.driver)].filter(Boolean).map((part) => t(part as string)).join(' · ') }}</span>
              <p v-if="leg.driver.platesHidden" class="confirm-page__no-plate">{{ t('司機沒有公開車牌。上車前請先打給司機，或向為你安排的人確認是哪一輛車。') }}</p>
              <div v-else class="confirm-page__plates">
                <PlateTag :hk="leg.driver.hkPlate" :macau="leg.driver.macauPlate" :mainland="leg.driver.mainlandPlate" />
              </div>
              <div v-if="leg.driver.photos.length" class="confirm-page__photos">
                <img v-for="photo in leg.driver.photos" :key="photo" :src="photo" :alt="t('司機的車')" loading="lazy" />
              </div>
              <ContactLines :phones="leg.driver.phones" />
            </div>
            <p v-else class="muted">{{ t('司機安排中，安排好後這裡會顯示司機和車牌。') }}</p>
          </section>
        </template>
      </template>

      <template v-else>
        <section class="card">
          <div class="confirm-page__time">{{ pickup(trip.pickupAt) }}</div>
          <RoutePoints :origin="trip.origin" :destination="trip.destination" :waypoints="trip.waypoints" />
          <p class="confirm-page__load">{{ t(loadLine(trip.passengers, trip.luggage, trip.vehicleType)) }}</p>
          <p v-if="trip.flightNo" class="confirm-page__load">{{ t(`航班：${trip.flightNo}`) }}</p>
          <div v-if="trip.price" class="confirm-page__price"><span>{{ t('費用') }}</span><strong>{{ money(trip.price) }}</strong></div>
        </section>

        <section v-if="trip.driver" class="card">
          <p class="confirm-page__label">{{ t('接送司機') }}</p>
          <p v-if="trip.status === 'ASSIGNED' && progressLine(trip.progress, clock)" class="confirm-page__progress">{{ t(progressLine(trip.progress, clock)) }}</p>
          <div class="confirm-page__driver">
            <strong>{{ trip.driver.name ? t(trip.driver.name) : t('司機') }}</strong>
            <span class="muted">{{ [trip.driver.vehicleType, trip.driver.color, plateKind(trip.driver)].filter(Boolean).map((part) => t(part as string)).join(' · ') }}</span>
            <p v-if="trip.driver.platesHidden" class="confirm-page__no-plate">{{ t('司機沒有公開車牌。上車前請先打給司機，或向為你安排的人確認是哪一輛車。') }}</p>
            <div v-else class="confirm-page__plates">
              <PlateTag :hk="trip.driver.hkPlate" :macau="trip.driver.macauPlate" :mainland="trip.driver.mainlandPlate" />
            </div>
            <div v-if="trip.driver.photos.length" class="confirm-page__photos">
              <img v-for="photo in trip.driver.photos" :key="photo" :src="photo" :alt="t('司機的車')" loading="lazy" />
            </div>
            <ContactLines :phones="trip.driver.phones" />
          </div>
        </section>
        <section v-else-if="trip.status === 'OPEN'" class="card muted">{{ t('司機安排中，安排好後這裡會顯示司機和車牌。') }}</section>
      </template>

      <!-- Who arranged the trip: the one to ask about changes, the price or anything else. -->
      <section v-if="trip.dispatcher" class="card">
        <p class="confirm-page__label">{{ t('行程有問題或要更改，聯絡為你安排的人') }}</p>
        <strong class="confirm-page__arranger">{{ trip.dispatcher.name ? t(trip.dispatcher.name) : t('安排行程的人') }}</strong>
        <ContactLines :phones="trip.dispatcher.phones" :wechat-id="trip.dispatcher.wechatId" :whatsapp="trip.dispatcher.whatsapp" />
        <!-- The customer stays the dispatcher's whoever drives: their page is where to book next time. -->
        <RouterLink v-if="trip.dispatcher.pageCode" class="button secondary block confirm-page__their-page" :to="`/p/${trip.dispatcher.pageCode}`">
          {{ trip.dispatcher.name ? t(`看${trip.dispatcher.name}的名片頁，下次直接約`) : t('看他的名片頁，下次直接約') }}
        </RouterLink>
      </section>

      <section v-if="trip.tripGroup && trip.status !== 'CANCELLED'" class="card">
        <p class="confirm-page__label">{{ t('行程群：你、司機和為你安排的人都在裡面') }}</p>
        <TripGroupJoin :group="trip.tripGroup" />
      </section>

      <!-- 收款: the dispatcher's own ways to be paid; the money goes straight to them. -->
      <section v-if="trip.payment && trip.status !== 'COMPLETED'" class="card confirm-page__pay">
        <span class="confirm-page__label">{{ trip.payment.payee ? t(`付款給 ${trip.payment.payee}`) : t('付款方式') }}</span>
        <strong v-if="trip.payment.amount" class="confirm-page__pay-amount">{{ money(trip.payment.amount) }}</strong>
        <p v-if="trip.payment.paid" class="confirm-page__paid">{{ t('已確認收到你的付款') }}</p>
        <div v-for="method in trip.payment.methods" :key="method.id" class="confirm-page__method">
          <div class="confirm-page__method-head">
            <strong>{{ t(method.label) }}</strong>
            <span v-if="method.label !== PAYMENT_KINDS[method.kind].name" class="hint">{{ t(PAYMENT_KINDS[method.kind].name) }}</span>
          </div>
          <img v-if="method.qrUrl" :src="method.qrUrl" :alt="t(`${method.label}收款碼`)" class="confirm-page__method-qr" />
          <p v-if="method.qrUrl" class="hint confirm-page__method-hint">{{ t('長按圖片可以儲存，再到對應的 App 掃碼付款') }}</p>
          <div v-if="method.account" class="confirm-page__method-account">
            <span>{{ method.account }}</span>
            <button class="chip" type="button" @click="copyAccount(method.account)">{{ t('複製') }}</button>
          </div>
        </div>
      </section>

      <p v-if="trip.status !== 'COMPLETED'" class="confirm-page__note">
        {{ trip.payment ? t('車費直接付給為你安排的司機，平台不經手。付款後請告訴對方。') : t('車費由你和司機直接約定和支付，平台不收款。') }}
      </p>

      <footer class="confirm-page__footer">
        <span>{{ t('由 MasterDriver 跨境師傅幫 提供') }}</span>
      </footer>

      <div v-if="!trip.passengerConfirmedAt && trip.status !== 'CANCELLED' && trip.status !== 'COMPLETED'" class="action-bar">
        <button class="button block large" type="button" :disabled="busy" @click="confirm">{{ busy ? t('確認中…') : t('確認行程') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.confirm-page__title {
  margin: var(--space-sm) 0 var(--space-lg);
  font-size: 20px;
  text-wrap: balance;
}
.confirm-page__done {
  font-weight: 600;
}
.confirm-page__progress {
  margin: 0 0 var(--space-sm);
  color: var(--status-confirmed);
  font-weight: 600;
}
.confirm-page__label {
  margin: 0 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
/* The driver's car, side by side, so the passenger can spot it. */
.confirm-page__photos {
  display: flex;
  gap: var(--space-sm);
  width: 100%;
  margin-bottom: var(--space-sm);
  overflow-x: auto;
}
.confirm-page__photos img {
  flex: 1 1 0;
  min-width: 96px;
  max-width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--radius-input);
  background: var(--color-tint);
}
.confirm-page__no-plate {
  margin: var(--space-xs) 0 var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  font-size: var(--font-label);
}
.confirm-page__ended {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-bottom: var(--space-lg);
  padding: var(--space-lg);
  border-radius: var(--radius-card);
  background: var(--status-confirmed-tint);
}
.confirm-page__ended-trip {
  font-weight: 600;
}
.confirm-page__ended strong {
  color: var(--status-confirmed);
  font-size: 20px;
}
.confirm-page__their-page {
  margin-top: var(--space-md);
}
.confirm-page__arranger {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 17px;
}
.confirm-page__time {
  margin-bottom: var(--space-lg);
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.confirm-page__load {
  margin: var(--space-lg) 0 0;
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-divider);
  color: var(--color-label);
  font-weight: 600;
}
.confirm-page__price {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: var(--space-md);
}
.confirm-page__price span {
  color: var(--color-text-secondary);
}
.confirm-page__price strong {
  color: var(--color-gold-ink);
  font-size: 20px;
}
.confirm-page__driver {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}
.confirm-page__driver strong {
  font-size: 20px;
}
/* Plates large enough to read at the kerb. */
.confirm-page__plates {
  margin: var(--space-sm) 0;
  font-size: 22px;
}
.confirm-page__transfer {
  margin: var(--space-sm) 0 0;
  color: var(--color-primary);
  font-weight: 600;
}
.confirm-page__pay {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.confirm-page__pay-amount {
  color: var(--color-gold-ink);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.confirm-page__paid {
  margin: 0;
  color: var(--status-confirmed);
  font-weight: 700;
}
.confirm-page__method {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  padding-top: var(--space-md);
  margin-top: var(--space-sm);
  border-top: 1px solid var(--color-divider);
}
.confirm-page__method-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}
.confirm-page__method-qr {
  align-self: center;
  width: 200px;
  max-width: 100%;
  border-radius: var(--radius-input);
  background: var(--color-surface);
}
.confirm-page__method-hint {
  align-self: center;
  margin: 0;
}
.confirm-page__method-account {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  align-self: stretch;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.confirm-page__note {
  margin: 0 0 var(--space-md);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  text-align: center;
}
.confirm-page__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding-top: var(--space-md);
  border-top: 1px dashed var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}
</style>
