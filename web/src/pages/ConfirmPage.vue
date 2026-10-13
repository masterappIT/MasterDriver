<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import PlateTag from '../components/PlateTag.vue';
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
      <p class="muted">{{ trip.dispatcherName ? t(`${trip.dispatcherName} 為你安排的行程`) : t('你的行程') }}</p>

      <div v-if="trip.status === 'CANCELLED'" class="notice error">{{ t('這個行程已取消，如有疑問請聯絡為你安排的司機。') }}</div>

      <template v-if="trip.legs && trip.legs.length > 1">
        <section class="card">
          <div class="confirm-page__time">{{ pickup(trip.pickupAt) }}</div>
          <div class="confirm-page__route">{{ t(trip.origin) }} → {{ t(trip.destination) }}</div>
          <p class="muted">{{ t(`${trip.passengers} 人・${trip.luggage} 件行李・中途換車，共 ${trip.legs.length} 段`) }}</p>
        </section>
        <template v-for="leg in trip.legs" :key="leg.legIndex">
          <p v-if="leg.legIndex > 1" class="confirm-page__handoff">
            ↓ {{ t(`接駁位置：${leg.origin}（在這裡換車）`) }}
          </p>
          <section class="card">
            <span class="leg-tag">{{ t(`第 ${leg.legIndex} 段`) }}</span>
            <div class="confirm-page__leg-time">{{ pickup(leg.pickupAt) }}</div>
            <div class="confirm-page__leg-route">{{ t(leg.origin) }} → {{ t(leg.destination) }}</div>
            <p v-if="leg.waypoints.length" class="muted">{{ t(`途經：${leg.waypoints.join('、')}`) }}</p>
            <p v-if="leg.price" class="confirm-page__price">{{ t('費用') }} {{ money(leg.price) }}</p>
            <template v-if="leg.driver">
              <p class="confirm-page__driver">{{ leg.driver.name ? t(leg.driver.name) : t('司機') }}</p>
              <div class="confirm-page__plates">
                <PlateTag :hk="leg.driver.hkPlate" :macau="leg.driver.macauPlate" :mainland="leg.driver.mainlandPlate" />
              </div>
              <p class="muted">{{ [leg.driver.vehicleType, leg.driver.color].filter(Boolean).map((part) => t(part as string)).join('・') }}</p>
              <a class="button secondary block" :href="`tel:${leg.driver.phone.replace(/\s/g, '')}`">{{ t('致電司機') }}</a>
            </template>
            <p v-else class="muted">{{ t('司機安排中，安排好後這裡會顯示司機和車牌。') }}</p>
          </section>
        </template>
      </template>

      <template v-else>
        <section class="card">
          <div class="confirm-page__time">{{ pickup(trip.pickupAt) }}</div>
          <div class="confirm-page__route">{{ t(trip.origin) }} → {{ t(trip.destination) }}</div>
          <p v-if="trip.waypoints.length" class="muted">{{ t(`途經：${trip.waypoints.join('、')}`) }}</p>
          <p class="muted">
            {{ t(`${trip.passengers} 人・${trip.luggage} 件行李`) }}<template v-if="trip.vehicleType">・{{ t(trip.vehicleType) }}</template>
          </p>
          <p v-if="trip.price" class="confirm-page__price">{{ t('費用') }} {{ money(trip.price) }}</p>
        </section>

        <section v-if="trip.driver" class="card">
          <h2>{{ t('接送司機') }}</h2>
          <p class="confirm-page__driver">{{ trip.driver.name ? t(trip.driver.name) : t('司機') }}</p>
          <div class="confirm-page__plates">
            <PlateTag :hk="trip.driver.hkPlate" :macau="trip.driver.macauPlate" :mainland="trip.driver.mainlandPlate" />
          </div>
          <p class="muted">
            {{ [trip.driver.vehicleType, trip.driver.color].filter(Boolean).map((part) => t(part as string)).join('・') }}
          </p>
          <a class="button secondary block" :href="`tel:${trip.driver.phone.replace(/\s/g, '')}`">{{ t('致電司機') }}</a>
        </section>
        <section v-else-if="trip.status === 'OPEN'" class="card muted">{{ t('司機安排中，安排好後這裡會顯示司機和車牌。') }}</section>
      </template>

      <p v-if="trip.passengerConfirmedAt" class="notice">{{ t(`你已於 ${shortTime(trip.passengerConfirmedAt)} 確認行程。`) }}</p>
      <div v-else-if="trip.status !== 'CANCELLED' && trip.status !== 'COMPLETED'" class="action-bar">
        <button class="button block large" type="button" :disabled="busy" @click="confirm">{{ t('確認行程') }}</button>
      </div>

      <p class="hint confirm-page__mark">{{ t('由 MasterDriver 跨境師傅幫 提供') }}</p>
    </template>
  </div>
</template>

<style scoped>
.confirm-page__time {
  font-size: 22px;
  font-weight: 700;
}
.confirm-page__route {
  font-size: 18px;
  font-weight: 600;
  margin: var(--space-sm) 0;
}
.confirm-page__price {
  font-size: var(--font-body-large);
  font-weight: 600;
}
.confirm-page__driver {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 var(--space-sm);
}
.confirm-page__plates {
  font-size: 20px;
  margin-bottom: var(--space-sm);
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
.confirm-page__mark {
  text-align: center;
  margin-top: var(--space-xl);
}
</style>
