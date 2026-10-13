<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import PlateTag from '../components/PlateTag.vue';
import RoutePoints from '../components/RoutePoints.vue';
import { money, pickup, shortTime } from '../format';
import { t } from '../i18n';

interface TripDriver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  vehicleType: string | null;
  color: string | null;
  phone: string;
}

/** 接駁: one leg of the trip, with its own driver. */
interface TripLeg {
  legIndex: number;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  waypoints: string[];
  vehicleType: string | null;
  price: { amount: number; currency: string } | null;
  driver: TripDriver | null;
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
  price: { amount: number; currency: string } | null;
  dispatcherName: string | null;
  passengerConfirmedAt: string | null;
  driver: TripDriver | null;
  /** Every leg that is not cancelled, when the trip changes cars on the way. */
  legs: TripLeg[] | null;
}

/** The passenger's page: no sign-in, no ads, never the driver price. */
const route = useRoute();
const confirmCode = String(route.params.confirmCode);
const trip = ref<PassengerView | null>(null);
const error = ref('');
const busy = ref(false);

async function load() {
  try {
    trip.value = await api<PassengerView>('GET', `/c/${confirmCode}`);
  } catch (e) {
    error.value = errorText(e);
  }
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

onMounted(load);
</script>

<template>
  <div class="page confirm-page">
    <div v-if="error" class="notice error">{{ error }}</div>
    <template v-if="trip">
      <h1 class="confirm-page__title">{{ trip.dispatcherName ? t(`${trip.dispatcherName} 為你安排的行程`) : t('你的行程') }}</h1>

      <div v-if="trip.status === 'CANCELLED'" class="notice error">{{ t('這個行程已取消，如有疑問請聯絡為你安排的司機。') }}</div>
      <p v-if="trip.passengerConfirmedAt" class="notice confirm-page__done">{{ t(`你已於 ${shortTime(trip.passengerConfirmedAt)} 確認行程。`) }}</p>

      <template v-if="trip.legs && trip.legs.length > 1">
        <section class="card">
          <div class="confirm-page__time">{{ pickup(trip.pickupAt) }}</div>
          <RoutePoints :origin="trip.origin" :destination="trip.destination" />
          <p class="confirm-page__load">{{ t(`${trip.passengers}人｜${trip.luggage}件行李｜中途換車，共 ${trip.legs.length} 段`) }}</p>
        </section>
        <template v-for="leg in trip.legs" :key="leg.legIndex">
          <p v-if="leg.legIndex > 1" class="confirm-page__handoff">
            {{ t(`接駁位置：${leg.origin}（在這裡換車）`) }}
          </p>
          <section class="card">
            <span class="leg-tag">{{ t(`第 ${leg.legIndex} 段`) }}</span>
            <div class="confirm-page__leg-time">{{ pickup(leg.pickupAt) }}</div>
            <div class="confirm-page__leg-route">{{ t(`${leg.origin} 至 ${leg.destination}`) }}</div>
            <p v-if="leg.waypoints.length" class="muted">{{ t(`途經：${leg.waypoints.join('、')}`) }}</p>
            <div v-if="leg.price" class="confirm-page__price"><span>{{ t('費用') }}</span><strong>{{ money(leg.price) }}</strong></div>
            <div v-if="leg.driver" class="confirm-page__driver">
              <strong>{{ leg.driver.name ? t(leg.driver.name) : t('司機') }}</strong>
              <span class="muted">{{ [leg.driver.vehicleType, leg.driver.color].filter(Boolean).map((part) => t(part as string)).join(' · ') }}</span>
              <div class="confirm-page__plates">
                <PlateTag :hk="leg.driver.hkPlate" :macau="leg.driver.macauPlate" :mainland="leg.driver.mainlandPlate" />
              </div>
              <a class="button secondary block" :href="`tel:${leg.driver.phone.replace(/\s/g, '')}`">{{ t('致電司機') }}</a>
            </div>
            <p v-else class="muted">{{ t('司機安排中，安排好後這裡會顯示司機和車牌。') }}</p>
          </section>
        </template>
      </template>

      <template v-else>
        <section class="card">
          <div class="confirm-page__time">{{ pickup(trip.pickupAt) }}</div>
          <RoutePoints :origin="trip.origin" :destination="trip.destination" :waypoints="trip.waypoints" />
          <p class="confirm-page__load">{{ t([`${trip.passengers}人`, `${trip.luggage}件行李`, trip.vehicleType].filter(Boolean).join('｜')) }}</p>
          <div v-if="trip.price" class="confirm-page__price"><span>{{ t('費用') }}</span><strong>{{ money(trip.price) }}</strong></div>
        </section>

        <section v-if="trip.driver" class="card">
          <p class="confirm-page__label">{{ t('接送司機') }}</p>
          <div class="confirm-page__driver">
            <strong>{{ trip.driver.name ? t(trip.driver.name) : t('司機') }}</strong>
            <span class="muted">{{ [trip.driver.vehicleType, trip.driver.color].filter(Boolean).map((part) => t(part as string)).join(' · ') }}</span>
            <div class="confirm-page__plates">
              <PlateTag :hk="trip.driver.hkPlate" :macau="trip.driver.macauPlate" :mainland="trip.driver.mainlandPlate" />
            </div>
            <a class="button secondary block" :href="`tel:${trip.driver.phone.replace(/\s/g, '')}`">{{ t('致電司機') }}</a>
          </div>
        </section>
        <section v-else-if="trip.status === 'OPEN'" class="card muted">{{ t('司機安排中，安排好後這裡會顯示司機和車牌。') }}</section>
      </template>

      <p class="confirm-page__note">{{ t('車費由你和司機直接約定和支付，平台不收款。') }}</p>

      <footer class="confirm-page__footer">
        <RouterLink to="/">{{ t('你也是司機？用師傅幫免費出單') }}</RouterLink>
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
.confirm-page__label {
  margin: 0 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
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
  font-size: 18px;
}
/* Plates large enough to read at the kerb. */
.confirm-page__plates {
  margin: var(--space-sm) 0;
  font-size: 20px;
}
.confirm-page__handoff {
  margin: 0 0 var(--space-md) var(--space-md);
  color: var(--color-text-secondary);
  font-weight: 600;
}
.confirm-page__leg-time {
  font-size: 18px;
  font-weight: 700;
  margin-top: var(--space-sm);
}
.confirm-page__leg-route {
  font-weight: 600;
  margin: var(--space-xs) 0 var(--space-sm);
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
