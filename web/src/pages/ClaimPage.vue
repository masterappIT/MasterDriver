<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText, session } from '../api';
import AdBanner from '../components/AdBanner.vue';
import AppIcon from '../components/AppIcon.vue';
import BrandHeader from '../components/BrandHeader.vue';
import ContactLines from '../components/ContactLines.vue';
import InlineStatus from '../components/InlineStatus.vue';
import JoinGroups, { type OfferedGroup } from '../components/JoinGroups.vue';
import JourneyLegs from '../components/JourneyLegs.vue';
import BottomSheet from '../components/BottomSheet.vue';
import PlateTag from '../components/PlateTag.vue';
import ProfileForm from '../components/ProfileForm.vue';
import RoutePoints from '../components/RoutePoints.vue';
import SectionHeading from '../components/SectionHeading.vue';
import { timeUntil } from '../relative-time';
import SignInForm from '../components/SignInForm.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { copyText } from '../device';
import { loadLine, money, pickup, plateKind, shortTime } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { legLabel, plateRequirement, type Journey, type PlateRegion } from '../journey';
import { toast } from '../toast';

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
  requiredPlates: PlateRegion[];
  journey: Journey | null;
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
const code = String(route.params.code);
const order = ref<ClaimView | null>(null);
const error = ref('');
const lost = ref(false);
const busy = ref(false);
const sheet = ref<'signIn' | 'profile' | null>(null);
let poller: ReturnType<typeof setInterval> | undefined;

const canClaim = computed(() => order.value?.status === 'OPEN' && order.value.viewer === 'other');

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

async function claim() {
  if (!session.user) {
    sheet.value = 'signIn';
    return;
  }
  if (!session.profile) {
    sheet.value = 'profile';
    return;
  }
  busy.value = true;
  try {
    const result = await api<{ result: 'WON' | 'LOST'; order: ClaimView }>('POST', `/o/${code}/claim`);
    order.value = result.order;
    lost.value = result.result === 'LOST';
    if (result.result === 'WON') toast('搶單成功！');
  } catch (e) {
    if ((e as { code?: string }).code === 'PROFILE_REQUIRED') sheet.value = 'profile';
    else toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function afterSignIn() {
  sheet.value = null;
  await load();
  if (canClaim.value) await claim();
}

async function afterProfile() {
  sheet.value = null;
  await claim();
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
    <PageBack fallback="/app/pool" only-in-app />
    <BrandHeader />

    <div v-if="error && !order" class="card claim-page__state">
      <AppIcon name="error" :size="40" />
      <p>{{ error }}</p>
    </div>
    <InlineStatus v-else-if="error" icon="error" tone="error">{{ error }}</InlineStatus>
    <div v-else-if="!order" class="claim-page__state claim-page__state--loading" role="status">{{ t('載入中…') }}</div>

    <template v-if="order">
      <InlineStatus v-if="lost" icon="cancel">{{ t('慢了一步，這張單已被其他司機接走。') }}</InlineStatus>
      <InlineStatus v-else-if="order.viewer === 'other' && order.status === 'CANCELLED'" icon="cancel">{{ t('這張單已被取消。') }}</InlineStatus>
      <InlineStatus v-else-if="order.viewer === 'other' && order.status !== 'OPEN'" icon="info">{{ t('這張單已被接走。') }}</InlineStatus>

      <!-- The winning driver: what the order is first, then the passenger and who put it out.
           Every group's link already shows the order as taken. -->
      <section v-if="order.viewer === 'driver'" class="card claim-page__won">
        <strong>{{ t('你接到這張單了') }}</strong>
        <span>{{ t(`${pickup(order.pickupAt)} · ${order.origin} 至 ${order.destination}`) }}</span>
        <RouterLink v-if="order.driver && !order.driver.photoIds?.length" class="claim-page__photo-hint" to="/app/profile-page">
          {{ t('上傳車輛照片，乘客在確認頁比較容易認車') }}
        </RouterLink>
      </section>
      <InlineStatus v-if="order.viewer === 'dispatcher'" icon="info">{{ t('這是你出的單。') }}</InlineStatus>

      <!-- The order, in the same order as the group text: time, route, load, price, notes. -->
      <section class="card claim-page__order">
        <div class="claim-page__tags">
          <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
          <span v-if="order.requiredPlates.length" class="gold-tag">{{ t(plateRequirement(order.requiredPlates)) }}</span>
          <span v-if="order.journey" class="leg-tag">{{ t(`接駁 ${legLabel(order.journey)}`) }}</span>
        </div>

        <div class="claim-page__when">
          <span class="claim-page__time">{{ pickup(order.pickupAt) }}</span>
          <span v-if="untilPickup && order.status === 'OPEN'" class="claim-page__until">{{ t(untilPickup) }}</span>
        </div>

        <RoutePoints :origin="order.origin" :destination="order.destination" :waypoints="order.waypoints" />
        <p v-if="order.journey" class="claim-page__transfer">{{ t(`在 ${order.journey.transferPlaces.join('、')} 換車`) }}</p>

        <div class="claim-page__load-row">
          <span class="claim-page__load">{{ t(loadText) }}</span>
          <span v-if="order.driverPrice && !canClaim" class="claim-page__price">{{ money(order.driverPrice) }}</span>
        </div>

        <p v-if="order.notes" class="claim-page__notes"><strong>{{ t('備註') }}</strong>{{ t(order.notes) }}</p>
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

      <section v-if="order.journey" class="card">
        <SectionHeading
          :title="t('整個行程')"
          :description="order.viewer === 'driver' ? t('其他段的司機搶到後會顯示在這裡；電話與乘客電話同時顯示，方便接駁時聯絡。') : undefined"
        />
        <JourneyLegs :legs="order.journey.legs" :current="order.journey.legIndex" />
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
          <span>{{ t('出單價') }}</span>
          <strong>{{ money(order.driverPrice) }}</strong>
        </div>
        <button class="button large claim-page__claim" type="button" :disabled="busy" @click="claim">
          {{ busy ? t('搶單中…') : t('立即搶單') }}
        </button>
      </div>
    </template>

    <BottomSheet v-if="sheet === 'signIn'" :title="t('登入後搶單')" @close="sheet = null">
      <SignInForm @signed-in="afterSignIn" />
    </BottomSheet>
    <BottomSheet v-if="sheet === 'profile'" :title="t('第一次搶單，請填司機資料')" @close="sheet = null">
      <ProfileForm @saved="afterProfile" />
    </BottomSheet>
  </div>
</template>

<style scoped>
.claim-page {
  display: flex;
  flex-direction: column;
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
