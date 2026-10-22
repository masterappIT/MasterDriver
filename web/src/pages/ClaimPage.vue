<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ensureSession, errorText, session } from '../api';
import AdBanner from '../components/AdBanner.vue';
import AppIcon from '../components/AppIcon.vue';
import BrandHeader from '../components/BrandHeader.vue';
import ContactLines from '../components/ContactLines.vue';
import InlineStatus from '../components/InlineStatus.vue';
import JoinGroups, { type OfferedGroup } from '../components/JoinGroups.vue';
import JourneyLegs from '../components/JourneyLegs.vue';
import CarpoolParties, { type CarpoolOnOrder } from '../components/CarpoolParties.vue';
import BottomSheet from '../components/BottomSheet.vue';
import PlateTag from '../components/PlateTag.vue';
import RoutePoints from '../components/RoutePoints.vue';
import SectionHeading from '../components/SectionHeading.vue';
import { timeUntil } from '../relative-time';
import SignInForm from '../components/SignInForm.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { copyText } from '../device';
import { loadLine, money, pickup, plateKind, shortTime } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { journeyRoute, journeyTag, legLabel, legName, plateRequirement, roundTripTotal, type Journey, type PlateRegion } from '../journey';
import { charterHours } from '@masterdriver/shared/charter';
import CharterRules from '../components/CharterRules.vue';
import type { OrderCharter } from '../charter';
import { toast } from '../toast';
import LinkProblem from '../components/LinkProblem.vue';

interface ClaimView {
  id?: string;
  code: string;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  driverPrice: { amount: number; currency: string } | null;
  notes: string | null;
  /** 航班號 of an airport pickup or drop-off. */
  flightNo: string | null;
  /** 即時單: pickupAt is when it was put out to leave now. */
  immediate?: boolean;
  /** 先給常用司機: until then only the dispatcher's 常用司機 may claim it. */
  favoritesOnlyUntil: string | null;
  requiredPlates: PlateRegion[];
  journey: Journey | null;
  /** 包車 (按小時計費): its hours and rules; null for any other order. */
  charter: OrderCharter | null;
  /** 拼車: the parties on board; before claiming, only where they get on and off. */
  carpool?: CarpoolOnOrder | null;
  dispatcherName: string | null;
  passengerConfirmedAt: string | null;
  viewer: 'dispatcher' | 'driver' | 'other';
  passengerName?: string | null;
  passengerContact?: string | null;
  contactRevealAt?: string | null;
  /** The trip is over: the passenger's phone is no longer shown to the driver. */
  contactEnded?: boolean;
  dispatcherPhone?: string;
  /** The winning driver's own details as the passenger will see them; photoIds are their vehicle photos. */
  driver?: { photoIds?: string[] } | null;
  /** The dispatcher's WeChat ID and WhatsApp from their 名片頁, for the driver who won. */
  dispatcherContact?: { wechatId: string | null; whatsapp: string | null; phones?: string[] };
  /** The dispatcher's 名片頁, when it is public: who you would be driving for. */
  dispatcherPageCode?: string | null;
  groupInvites: OfferedGroup[];
  /** Trips the dispatcher took and finished in the tool, counted like the 名片頁 figure. */
  dispatcherCompletedTrips?: number;
}

const POLL_MS = 5000;
const route = useRoute();
const router = useRouter();
const code = String(route.params.code);
const order = ref<ClaimView | null>(null);
const error = ref('');
const lost = ref(false);
const busy = ref(false);
const sheet = ref<'signIn' | null>(null);
let poller: ReturnType<typeof setInterval> | undefined;

/** 接駁 or 往返: the order this link belongs to, in two legs. */
const trip = computed(() => order.value?.journey ?? null);
const roundTrip = computed(() => trip.value?.kind === 'ROUND_TRIP');
/** 往返 同一位司機來回: one claim takes both legs, from either leg's link. */
const together = computed(() => roundTrip.value && Boolean(trip.value?.sameDriver));
/** 同一位司機來回: what both legs pay together, as the group text says it. */
const togetherTotal = computed(() => (together.value && trip.value ? roundTripTotal(trip.value.legs) : null));
/** 同一位司機來回 is offered while no leg has a driver yet. */
const togetherOpen = computed(() => Boolean(together.value && trip.value?.legs.every((leg) => leg.status === 'OPEN')));
/** 往返 可分開接: a driver who holds one leg may take the other one too. */
const otherOpenLegs = computed(() =>
  roundTrip.value && !together.value && order.value?.viewer === 'driver' ? (trip.value?.legs.filter((leg) => leg.status === 'OPEN' && !leg.mine) ?? []) : [],
);
/** Opened from the group by someone who holds neither leg: the page offers both legs to choose from. */
const offering = computed(() => Boolean(trip.value && order.value?.viewer === 'other'));
/** The leg this driver already holds, when the link they opened is the other leg's. */
const myLeg = computed(() => (offering.value ? (trip.value?.legs.find((leg) => leg.mine) ?? null) : null));
/** A 直達 order is claimed with the bar at the bottom; a 接駁 order leg by leg. */
const canClaim = computed(() => !trip.value && order.value?.status === 'OPEN' && order.value.viewer === 'other');
/** The waiting leg after signing in, to claim it once the page knows who this is. */
let pendingLeg: string | null = null;

/** Ticks every half minute so "2 小時後" stays right while the page is open. */
const now = ref(new Date());
let clock: ReturnType<typeof setInterval> | undefined;
const untilPickup = computed(() => (order.value ? timeUntil(order.value.pickupAt, now.value) : null));

/** "4人｜3件行李｜7座", the same line as in the group text. */
const loadText = computed(() => {
  const o = order.value;
  return o ? loadLine(o.passengers, o.luggage, o.vehicleType) : '';
});

async function load() {
  try {
    order.value = await api<ClaimView>('GET', `/o/${code}`);
    error.value = '';
  } catch (e) {
    error.value = errorText(e);
  }
}

/** Keep the status fresh while the order is still open, so a taken order shows as taken in every group. */
function poll() {
  clearInterval(poller);
  poller = setInterval(() => {
    if (document.visibilityState === 'visible' && order.value?.status === 'OPEN') void load();
  }, POLL_MS);
}

/** Claims this order, or with 接駁 the leg whose code is given. */
async function claim(legCode = code) {
  // The page opens before the sign-in check is back (router.ts); a tap waits for it.
  busy.value = true;
  await ensureSession();
  busy.value = false;
  if (!session.user) {
    pendingLeg = legCode;
    sheet.value = 'signIn';
    return;
  }
  if (!session.profile) {
    fillProfile();
    return;
  }
  busy.value = true;
  try {
    const result = await api<{ result: 'WON' | 'LOST'; order: ClaimView }>('POST', `/o/${legCode}/claim`);
    lost.value = result.result === 'LOST';
    if (result.result === 'WON') toast('搶單成功！');
    // 接駁: the other leg's link becomes this driver's own leg's page.
    if (legCode !== code) {
      if (result.result === 'WON') await router.replace(`/o/${legCode}`);
      else await load();
      return;
    }
    order.value = result.order;
  } catch (e) {
    if ((e as { code?: string }).code === 'PROFILE_REQUIRED') fillProfile();
    else toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function afterSignIn() {
  sheet.value = null;
  await load();
  const leg = pendingLeg;
  pendingLeg = null;
  if (canClaim.value) await claim();
  else if (leg && trip.value?.legs.some((one) => one.code === leg && one.status === 'OPEN') && !myLeg.value) await claim(leg);
}

// Someone who holds one leg and opens the order's link is shown their own leg.
watch(myLeg, (leg) => {
  if (leg && leg.code !== code) void router.replace(`/o/${leg.code}`);
});

/** A first claim needs the driver's details: they are filled in on their own page, which comes back here. */
function fillProfile() {
  toast('第一次搶單，請先填司機資料');
  void router.push({ path: '/app/profile', query: { next: `/o/${code}` } });
}

async function copy(text: string, done: string) {
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

onMounted(async () => {
  clock = setInterval(() => (now.value = new Date()), 30_000);
  await load();
  poll();
});
onBeforeUnmount(() => {
  clearInterval(poller);
  clearInterval(clock);
});
</script>

<template>
  <div class="page claim-page">
    <PageBack fallback="/app/pool" history only-in-app />
    <BrandHeader />

    <LinkProblem v-if="error && !order" :message="error" :brand="false" next="回到群裡看看這張單還在不在，或請出單者重新分享連結。" />
    <InlineStatus v-else-if="error" icon="error" tone="error">{{ error }}</InlineStatus>
    <div v-else-if="!order" class="claim-page__state claim-page__state--loading" role="status">{{ t('載入中…') }}</div>

    <template v-if="order">
      <InlineStatus v-if="lost" icon="cancel">{{ t('慢了一步，這張單已被其他司機接走。') }}</InlineStatus>
      <InlineStatus v-else-if="order.viewer === 'other' && (trip?.status ?? order.status) === 'CANCELLED'" icon="cancel">{{ t('這張單已被取消。') }}</InlineStatus>
      <InlineStatus v-else-if="order.viewer === 'other' && (trip?.status ?? order.status) !== 'OPEN'" icon="info">
        {{ roundTrip ? t('去程和回程都已有司機。') : trip ? t('兩段都已有司機。') : t('這張單已被接走。') }}
      </InlineStatus>

      <!-- The winning driver: what the order is first, then the passenger and who put it out.
           Every group's link already shows the order as taken. -->
      <section v-if="order.viewer === 'driver'" class="card claim-page__won">
        <template v-if="together && trip">
          <strong>{{ t('你接到這張往返單了，去程和回程都是你開') }}</strong>
          <span>{{ t(`${pickup(trip.legs[0].pickupAt)} · ${journeyRoute(trip)}`) }}</span>
        </template>
        <template v-else>
          <strong>{{ t('你接到這張單了') }}</strong>
          <span>{{ t(`${pickup(order.pickupAt)} · ${order.origin} 至 ${order.destination}`) }}</span>
        </template>
        <!-- 行程進度 is reported on the order's own page; say so while the driver is still here. -->
        <RouterLink v-if="order.id && order.status === 'ASSIGNED'" class="claim-page__progress-hint" :to="`/app/orders/${order.id}`">
          {{ t('出發、到了上車點、乘客上車時，打開這張單各按一下') }}
        </RouterLink>
        <RouterLink v-if="order.driver && !order.driver.photoIds?.length" class="claim-page__photo-hint" to="/app/profile-page">
          {{ t('上傳車輛照片，乘客在確認頁比較容易認車') }}
        </RouterLink>
      </section>
      <InlineStatus v-if="order.viewer === 'dispatcher'" icon="info">{{ t('這是你出的單。') }}</InlineStatus>

      <!-- The order, in the same order as the group text: time, route, load, price, notes. -->
      <section class="card claim-page__order">
        <div class="claim-page__tags">
          <StatusBadge :status="offering ? trip!.status : order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
          <span v-if="!offering && order.requiredPlates.length" class="gold-tag">{{ t(plateRequirement(order.requiredPlates)) }}</span>
          <span v-if="offering" class="leg-tag">{{ t(journeyTag(trip!)) }}</span>
          <span v-else-if="trip" class="leg-tag">{{ t(`${roundTrip ? '往返' : '接駁'} ${legLabel(trip)}`) }}</span>
          <span v-if="order.charter" class="leg-tag">{{ t(`包車 ${charterHours(order.charter.minutes)}`) }}</span>
        </div>

        <div class="claim-page__when">
          <template v-if="order.immediate && order.status === 'OPEN'">
            <span class="claim-page__time">{{ t('現在出發') }}</span>
            <span class="now-tag">{{ t('即時') }}</span>
          </template>
          <template v-else>
            <span class="claim-page__time">{{ pickup(order.pickupAt) }}</span>
            <span v-if="order.immediate" class="now-tag">{{ t('即時') }}</span>
            <span v-if="untilPickup && order.status === 'OPEN'" class="claim-page__until">{{ t(untilPickup) }}</span>
          </template>
        </div>

        <RoutePoints
          :origin="offering ? trip!.origin : order.origin"
          :destination="offering ? trip!.destination : order.destination"
          :waypoints="order.waypoints"
        />
        <p v-if="trip && !roundTrip" class="claim-page__transfer">{{ t(`在 ${trip.transferPlaces.join('、')} 換車`) }}</p>

        <div class="claim-page__load-row">
          <span class="claim-page__load">{{ t(loadText) }}</span>
          <span v-if="order.driverPrice && !canClaim && !offering" class="claim-page__price">{{ money(order.driverPrice) }}</span>
        </div>
        <CharterRules
          v-if="order.charter"
          :minutes="order.charter.minutes"
          :start="order.immediate ? null : order.pickupAt"
          :hourly="order.charter.driverHourly"
          :total="order.driverPrice"
          :overtime-hourly="order.charter.overtimeDriverHourly"
          :overtime-unit-minutes="order.charter.overtimeUnitMinutes"
          :overtime-grace-minutes="order.charter.overtimeGraceMinutes"
          :extras="order.charter.extras"
        />

        <!-- 往返 from the group: each leg below shows its own flight. -->
        <p v-if="order.flightNo && !(offering && roundTrip)" class="claim-page__notes"><strong>{{ t('航班') }}</strong>{{ order.flightNo }}</p>
        <p v-if="order.notes" class="claim-page__notes"><strong>{{ t('備註') }}</strong>{{ t(order.notes) }}</p>
        <p v-if="order.favoritesOnlyUntil && order.viewer !== 'dispatcher'" class="claim-page__notes">
          <strong>{{ t('先給常用司機') }}</strong>{{ t(`出單者的常用司機先搶，${shortTime(order.favoritesOnlyUntil).split(' ')[1]} 後所有人都可以搶`) }}
        </p>
      </section>

      <template v-if="order.viewer === 'driver'">
        <section class="card">
          <p class="claim-page__label">{{ t('乘客') }}</p>
          <p v-if="order.contactEnded" class="claim-page__reveal">{{ t('行程已結束，乘客電話不再顯示。有需要請聯絡出單者。') }}</p>
          <p v-else-if="!order.passengerContact" class="claim-page__reveal">
            {{ t(`乘客電話將於 ${shortTime(order.contactRevealAt ?? null)} 顯示。之前如需安排，請聯絡出單者。`) }}
          </p>
          <template v-else>
            <div class="claim-page__person">
              <strong>{{ order.passengerName ?? t('乘客') }}</strong>
              <span class="claim-page__number">{{ order.passengerContact }}</span>
            </div>
            <div class="claim-page__buttons">
              <a class="button secondary" :href="`tel:${order.passengerContact?.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電乘客') }}</a>
              <button class="button secondary" type="button" @click="copy(order.passengerContact ?? '', '已複製號碼')">
                <AppIcon name="copy" :size="18" />{{ t('複製號碼') }}
              </button>
            </div>
          </template>
        </section>

        <section class="card claim-page__people">
          <div v-if="order.dispatcherPhone" class="claim-page__contact">
            <span>
              <strong>{{ order.dispatcherName ? t(`${order.dispatcherName} 出的單`) : t('出單者') }}</strong>
              <small>{{ order.dispatcherPhone }}</small>
            </span>
            <a class="chip" :href="`tel:${order.dispatcherPhone.replace(/\s/g, '')}`">{{ t('致電出單者') }}</a>
          </div>
          <ContactLines :phones="order.dispatcherContact?.phones?.slice(1)" :wechat-id="order.dispatcherContact?.wechatId" :whatsapp="order.dispatcherContact?.whatsapp" />
          <RouterLink v-if="order.dispatcherPageCode" class="claim-page__contact claim-page__card-link" :to="`/p/${order.dispatcherPageCode}`">{{ t('看出單者的名片') }}</RouterLink>
          <div v-if="session.profile?.hkPlate || session.profile?.macauPlate || session.profile?.mainlandPlate" class="claim-page__contact">
            <span><small>{{ [t('你開的車'), t(plateKind(session.profile))].filter(Boolean).join(' · ') }}</small></span>
            <PlateTag :hk="session.profile?.hkPlate" :macau="session.profile?.macauPlate" :mainland="session.profile?.mainlandPlate" />
          </div>
        </section>
      </template>


      <!-- Who put the order out, as one line: "陳師傅出的單 · 已在師傅幫完成 128 張單". -->
      <p v-if="order.viewer !== 'driver'" class="claim-page__dispatcher">
        <strong>{{ order.dispatcherName ? t(`${order.dispatcherName} 出的單`) : t('出單者沒有留名') }}</strong>
        <RouterLink v-if="order.dispatcherPageCode && order.viewer === 'other'" class="claim-page__card-link" :to="`/p/${order.dispatcherPageCode}`">{{ t('看名片') }}</RouterLink>
        <span v-if="order.dispatcherCompletedTrips">{{ t(`已在師傅幫完成 ${order.dispatcherCompletedTrips} 張單`) }}</span>
      </p>

      <!-- 拼車: the stops a driver makes, before they claim. -->
      <section v-if="order.carpool" class="card">
        <CarpoolParties :carpool="order.carpool" :destination="order.destination" />
      </section>

      <!-- 接駁 and 往返 from the group: each leg with its own time, plates and price; a button per leg,
           or one for both legs of 同一位司機來回. -->
      <section v-if="offering && trip" class="card claim-page__legs">
        <SectionHeading
          :title="t(together ? '去程和回程一起搶' : roundTrip ? '選一程搶' : '選一段搶')"
          :description="
            t(
              together
                ? '同一位司機來回，一搶就是去程和回程。'
                : roundTrip
                  ? '去程和回程各自搶，同一位司機也可以兩程都搶。'
                  : '兩段各由一位司機接，同一位司機只能接其中一段。',
            )
          "
        />
        <div v-for="leg in trip.legs" :key="leg.legIndex" class="claim-page__leg" :class="{ 'claim-page__leg--open': leg.status === 'OPEN' }">
          <div class="claim-page__leg-top">
            <span class="leg-tag">{{ t(legName(trip.kind, leg.legIndex)) }}</span>
            <span v-if="leg.requiredPlates.length" class="gold-tag">{{ t(plateRequirement(leg.requiredPlates)) }}</span>
            <strong v-if="leg.driverPrice && !leg.selfDrive" class="claim-page__leg-price">{{ money(leg.driverPrice) }}</strong>
          </div>
          <span class="claim-page__leg-time">{{ leg.immediate && leg.status === 'OPEN' ? t('現在出發') : pickup(leg.pickupAt) }}</span>
          <span>{{ t(`${leg.origin} 至 ${leg.destination}`) }}</span>
          <span v-if="roundTrip && leg.flightNo">{{ t(`航班 ${leg.flightNo}`) }}</span>
          <button v-if="leg.status === 'OPEN' && !together" class="button block claim-page__leg-claim" type="button" :disabled="busy" @click="claim(leg.code)">
            {{ busy ? t('搶單中…') : t(`搶${legName(trip.kind, leg.legIndex)}`) }}
          </button>
          <p v-else-if="leg.status !== 'OPEN'" class="hint">{{ leg.selfDrive ? t('出單者自己開') : leg.status === 'CANCELLED' ? t('已取消') : t('已有司機') }}</p>
        </div>
        <p v-if="togetherTotal" class="claim-page__total">
          <span>{{ t('來回共') }}</span><strong>{{ money(togetherTotal) }}</strong>
        </p>
        <button v-if="togetherOpen" class="button block claim-page__leg-claim" type="button" :disabled="busy" @click="claim()">
          {{ busy ? t('搶單中…') : t('搶來回') }}
        </button>
      </section>

      <section v-if="trip && !offering" class="card">
        <SectionHeading
          :title="t('整個行程')"
          :description="
            order.viewer !== 'driver'
              ? undefined
              : together || (roundTrip && trip.legs.every((leg) => leg.mine))
                ? t('去程和回程都由你開，每一程出發、到達都在各自的單上回報。')
                : otherOpenLegs.length
                  ? t('另一程還沒有人接，你也可以一起搶下來。')
                  : roundTrip
                    ? t('另一程的司機搶到後會顯示在這裡。')
                    : t('另一段的司機搶到後會顯示在這裡；電話與乘客電話同時顯示，方便接駁時聯絡。')
          "
        />
        <JourneyLegs :legs="trip.legs" :current="trip.legIndex" :kind="trip.kind" />
        <button
          v-for="leg in otherOpenLegs"
          :key="leg.legIndex"
          class="button block claim-page__leg-claim"
          type="button"
          :disabled="busy"
          @click="claim(leg.code)"
        >
          {{ busy ? t('搶單中…') : t(`也搶${legName(trip.kind, leg.legIndex)}`) }}
        </button>
      </section>

      <RouterLink v-if="order.viewer === 'dispatcher' && order.id" class="button block" :to="`/app/orders/${order.id}`">{{ t('管理這張單') }}</RouterLink>
      <RouterLink v-if="order.viewer === 'driver' && order.id" class="claim-page__more" :to="`/app/orders/${order.id}`">{{ t('在「訂單」查看這張單') }}</RouterLink>

      <JoinGroups v-if="order.viewer !== 'dispatcher'" :groups="order.groupInvites" :dispatcher-name="order.dispatcherName" />

      <AdBanner position="CLAIM_PAGE" />

      <footer class="claim-page__footer">
        <RouterLink v-if="order.viewer === 'other'" to="/">{{ t('這張單用師傅幫出單 · 免費使用') }}</RouterLink>
        <span>{{ t('使用上有問題？') }}<RouterLink to="/support">{{ t('聯絡客服') }}</RouterLink></span>
      </footer>

      <!-- Price on the left and the button on the right, within reach of one thumb. -->
      <div v-if="canClaim" class="action-bar claim-page__bar">
        <div v-if="order.driverPrice" class="claim-page__bar-price">
          <span>{{ order.charter ? t(`出單價（${charterHours(order.charter.minutes)}）`) : t('出單價') }}</span>
          <strong>{{ money(order.driverPrice) }}</strong>
        </div>
        <button class="button large claim-page__claim" type="button" :disabled="busy" @click="claim()">
          {{ busy ? t('搶單中…') : t('立即搶單') }}
        </button>
      </div>
    </template>

    <BottomSheet v-if="sheet === 'signIn'" :title="t('登入後搶單')" @close="sheet = null">
      <SignInForm @signed-in="afterSignIn" />
    </BottomSheet>
  </div>
</template>

<style scoped>
.claim-page {
  display: flex;
  flex-direction: column;
}
.claim-page__leg {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-input);
  color: var(--color-text-secondary);
}
.claim-page__leg + .claim-page__leg {
  margin-top: var(--space-sm);
}
.claim-page__leg--open {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.claim-page__leg-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.claim-page__total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: var(--space-md) 0 0;
}
.claim-page__total strong {
  font-size: 20px;
}
.claim-page__leg-price {
  margin-left: auto;
  font-size: 18px;
}
.claim-page__leg-time {
  font-weight: 600;
}
.claim-page__leg-claim {
  margin-top: var(--space-xs);
}
.claim-page > .card,
.claim-page > :deep(.inline-status) {
  margin-bottom: var(--space-md);
}
.claim-page__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  text-align: center;
  color: var(--color-text-secondary);
}
.claim-page__state p {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-body-large);
  font-weight: 600;
}
.claim-page__state--loading {
  padding: var(--space-xl) 0;
}
.claim-page__label {
  display: block;
  margin: 0 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.claim-page__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
}
.claim-page__when {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-sm) var(--space-md);
  margin: var(--space-md) 0 var(--space-lg);
}
.claim-page__time {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}
.claim-page__until {
  color: var(--color-teal);
  font-size: var(--font-label);
  font-weight: 700;
}
.claim-page__transfer {
  margin: var(--space-md) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.claim-page__load-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-lg);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-divider);
}
.claim-page__load {
  color: var(--color-label);
  font-weight: 600;
}
.claim-page__price,
.claim-page__bar-price strong {
  color: var(--color-gold-ink);
  font-size: 20px;
  font-weight: 700;
  white-space: nowrap;
}
.claim-page__notes {
  display: flex;
  gap: var(--space-sm);
  margin: var(--space-md) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  overflow-wrap: anywhere;
}
.claim-page__notes strong {
  flex-shrink: 0;
}
.claim-page__dispatcher {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-xs) var(--space-sm);
  margin: 0 var(--space-xs) var(--space-lg);
}
.claim-page__card-link {
  font-size: var(--font-label);
  font-weight: 600;
}
.claim-page__dispatcher span {
  padding: 1px var(--space-sm);
  border-radius: var(--radius-pill);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  font-size: var(--font-caption);
  font-weight: 600;
}
.claim-page__contact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
}
.claim-page__people > * + .claim-page__contact {
  border-top: 1px solid var(--color-divider);
}
/* The words on the left stack; the plates on the right are a span too and keep their own row. */
.claim-page__contact > span:not(.plate-tag) {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.claim-page__contact > .plate-tag {
  justify-content: flex-end;
}
.claim-page__contact small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.claim-page__won {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  text-align: center;
  background: var(--color-tint);
}
.claim-page__progress-hint,
.claim-page__photo-hint {
  margin-top: var(--space-xs);
  font-size: var(--font-label);
  font-weight: 600;
}
.claim-page__won strong {
  font-size: 20px;
}
.claim-page__won span {
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.claim-page__person {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
}
.claim-page__number {
  font-variant-numeric: tabular-nums;
}
.claim-page__reveal {
  margin: 0;
  color: var(--color-text-secondary);
}
.claim-page__buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}
.claim-page__more {
  display: block;
  margin-bottom: var(--space-md);
  text-align: center;
}
.claim-page > .button.block {
  margin-bottom: var(--space-md);
}
.claim-page__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px dashed var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}
.claim-page__bar {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
}
.claim-page__bar-price {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}
.claim-page__bar-price span {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.claim-page__claim {
  flex: 1;
}
</style>
