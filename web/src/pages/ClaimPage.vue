<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText, session } from '../api';
import AdBanner from '../components/AdBanner.vue';
import JoinGroups, { type OfferedGroup } from '../components/JoinGroups.vue';
import BottomSheet from '../components/BottomSheet.vue';
import PlateTag from '../components/PlateTag.vue';
import ProfileForm from '../components/ProfileForm.vue';
import SignInForm from '../components/SignInForm.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { copyText } from '../device';
import { money, pickup, plates, shortTime } from '../format';
import { t } from '../i18n';
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
  dispatcherName: string | null;
  passengerConfirmedAt: string | null;
  viewer: 'dispatcher' | 'driver' | 'other';
  passengerName?: string | null;
  passengerContact?: string | null;
  contactRevealAt?: string | null;
  dispatcherPhone?: string;
  groupInvites: OfferedGroup[];
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

/** What the winning driver pastes back into the group. */
const claimedMessage = computed(() => {
  const o = order.value;
  if (!o) return '';
  const driverPlates = plates(session.profile);
  return [`【已接單】${pickup(o.pickupAt)} ${o.origin} → ${o.destination}`, `司機：${session.profile?.name ?? ''}`, driverPlates ? `車牌：${driverPlates}` : '']
    .filter(Boolean)
    .join('\n');
});

async function copy(text: string, done: string) {
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

onMounted(async () => {
  await load();
  poll();
});
onBeforeUnmount(() => clearInterval(poller));
</script>

<template>
  <div class="page claim-page">
    <header class="claim-page__brand">
      <strong>MasterDriver</strong>
      <span>{{ t('跨境師傅幫｜有單就派，有空就接') }}</span>
    </header>

    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="order">
      <div v-if="lost" class="notice">{{ t('慢了一步，這張單已被其他司機接走。') }}</div>

      <section class="card claim-page__order">
        <div class="claim-page__top">
          <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
          <span v-if="order.driverPrice" class="claim-page__price">{{ money(order.driverPrice) }}</span>
        </div>
        <div class="claim-page__time">{{ pickup(order.pickupAt) }}</div>
        <div class="claim-page__route">
          <div>{{ t(order.origin) }}</div>
          <div v-for="stop in order.waypoints" :key="stop" class="claim-page__stop">{{ t(`途經：${stop}`) }}</div>
          <div class="claim-page__arrow">↓</div>
          <div>{{ t(order.destination) }}</div>
        </div>
        <div class="row claim-page__load">
          <span>{{ t(`${order.passengers} 人`) }}</span>
          <span>{{ t(`${order.luggage} 件行李`) }}</span>
          <span v-if="order.vehicleType">{{ t(order.vehicleType) }}</span>
        </div>
        <p v-if="order.notes" class="claim-page__notes">{{ t(`備註：${order.notes}`) }}</p>
        <p class="hint">{{ t(`發單：${order.dispatcherName ?? '—'}`) }}</p>
      </section>

      <section v-if="order.viewer === 'driver'" class="card">
        <h2>{{ t('乘客資料') }}</h2>
        <p v-if="!order.passengerContact" class="notice">
          {{ t(`乘客電話將於 ${shortTime(order.contactRevealAt ?? null)} 顯示。之前如需安排，請聯絡派單者。`) }}
        </p>
        <p v-else>{{ order.passengerName ?? t('乘客') }}：<strong>{{ order.passengerContact }}</strong></p>
        <div v-if="order.passengerContact" class="row">
          <a class="button" :href="`tel:${order.passengerContact?.replace(/\s/g, '')}`">{{ t('致電乘客') }}</a>
          <button class="button secondary" type="button" @click="copy(order.passengerContact ?? '', '已複製號碼')">{{ t('複製號碼') }}</button>
        </div>
        <button class="button block claim-page__share" type="button" @click="copy(claimedMessage, '已複製，可貼回群裡')">
          {{ t('複製「已接單」訊息貼回群') }}
        </button>
        <p class="hint">
          <PlateTag :hk="session.profile?.hkPlate" :macau="session.profile?.macauPlate" :mainland="session.profile?.mainlandPlate" />
        </p>
        <p v-if="order.dispatcherPhone" class="claim-page__dispatcher">
          {{ t(`派單者 ${order.dispatcherName ?? ''}`) }}：<a :href="`tel:${order.dispatcherPhone.replace(/\s/g, '')}`">{{ order.dispatcherPhone }}</a>
        </p>
        <RouterLink v-if="order.id" :to="`/app/orders/${order.id}`">{{ t('在「我的單」查看這張單') }}</RouterLink>
      </section>

      <section v-else-if="order.viewer === 'dispatcher'" class="card">
        <p>{{ t('這是你發的單。') }}</p>
        <RouterLink v-if="order.id" class="button block" :to="`/app/orders/${order.id}`">{{ t('管理這張單') }}</RouterLink>
      </section>

      <p v-else-if="order.status !== 'OPEN'" class="notice">
        {{ order.status === 'CANCELLED' ? t('這張單已被取消。') : t('這張單已被接走。') }}
      </p>

      <JoinGroups v-if="order.viewer !== 'dispatcher'" :groups="order.groupInvites" :dispatcher-name="order.dispatcherName" />

      <AdBanner position="CLAIM_PAGE" />

      <div v-if="canClaim" class="action-bar">
        <button class="button block large" type="button" :disabled="busy" @click="claim">{{ t('立即搶單') }}</button>
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
.claim-page__brand {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-lg);
}
.claim-page__brand span {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.claim-page__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.claim-page__price {
  font-size: 24px;
  font-weight: 700;
}
.claim-page__time {
  font-size: 22px;
  font-weight: 700;
  margin: var(--space-md) 0;
}
.claim-page__route {
  font-size: 18px;
  font-weight: 600;
}
.claim-page__stop {
  font-size: var(--font-body);
  font-weight: 400;
  color: var(--color-text-secondary);
}
.claim-page__arrow {
  color: var(--color-text-muted);
}
.claim-page__load {
  margin: var(--space-md) 0;
  color: var(--color-label);
}
.claim-page__notes {
  background: var(--color-background);
  border-radius: var(--radius-input);
  padding: var(--space-sm) var(--space-md);
}
.claim-page__dispatcher {
  margin: var(--space-md) 0 var(--space-sm);
}
.claim-page__share {
  margin-top: var(--space-md);
}
</style>
