<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import { bookingOpen, bookingStatusText, returnRoute, passengerTone, type Booking } from '../booking';
import PoolRadar from '../components/PoolRadar.vue';
import { copyText } from '../device';
import { loadLine, money, pickup } from '../format';
import { t } from '../i18n';
import { toast } from '../toast';
import LinkProblem from '../components/LinkProblem.vue';

interface PassengerBooking extends Booking {
  driverName: string | null;
  pageCode: string | null;
  confirmUrl: string | null;
}

/** The passenger's own link to one booking request: its status, the driver's quote, and what to do next. */
const POLL_MS = 10_000;
const route = useRoute();
const code = String(route.params.code);
const justSent = route.query.sent === '1';
const booking = ref<PassengerBooking | null>(null);
const error = ref('');
const busy = ref(false);
let poller: ReturnType<typeof setInterval> | undefined;

/** While it waits on the driver, the page says so with a turning radar: it is still being looked at. */
const waiting = computed(() => {
  const status = booking.value?.status;
  const deal = Boolean(booking.value?.deal);
  if (status === 'PENDING') return deal ? '正在等司機確認你的預約' : '正在等司機報價';
  if (status === 'ACCEPTED') return deal ? '你已訂到，正在等司機安排行程' : '你已同意報價，正在等司機安排行程';
  return null;
});

async function load() {
  try {
    booking.value = await api<PassengerBooking>('GET', `/public/bookings/${code}`);
    error.value = '';
  } catch (e) {
    if (!booking.value) error.value = errorText(e);
  }
}

async function act(action: 'accept' | 'cancel', question?: string) {
  if (question && !confirm(t(question))) return;
  busy.value = true;
  try {
    booking.value = await api<PassengerBooking>('POST', `/public/bookings/${code}/${action}`);
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

/** The driver answers later: keep the page current while the request is open, and when the passenger comes back to it. */
function refresh() {
  if (!document.hidden && !busy.value && booking.value && bookingOpen(booking.value.status)) void load();
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
    <h1>{{ t('我的預約') }}</h1>
    <LinkProblem v-if="error && !booking" :message="error" next="請聯絡你詢價的司機，或回到司機的名片頁重新詢價。" />
    <div v-else-if="error" class="notice error">{{ error }}</div>

    <template v-if="booking">
      <div v-if="justSent" class="notice booking__sent">
        <span>{{ t('預約已送出。請保存這個頁面的連結，司機回覆後在這裡看得到；司機也可能直接用你留的聯絡方式找你。') }}</span>
        <button class="chip" type="button" @click="copyLink">{{ t('複製連結') }}</button>
      </div>

      <section v-if="waiting" class="card booking__waiting" role="status">
        <PoolRadar :size="64" />
        <div>
          <strong>{{ t(waiting) }}</strong>
          <p class="hint">{{ t('司機回覆後，這一頁會自動更新，不用重新整理。') }}</p>
        </div>
      </section>

      <section class="card booking__trip">
        <span class="booking__status" :class="`booking__status--${passengerTone(booking.status)}`">{{ t(bookingStatusText(booking, 'passenger')) }}</span>
        <strong class="booking__time">{{ pickup(booking.pickupAt) }}</strong>
        <div class="booking__route">{{ t(`${booking.origin} ${booking.roundTrip && !returnRoute(booking) ? '往返' : '至'} ${booking.destination}`) }}</div>
        <!-- 往返: when and, if not the way there reversed, from where to where the passenger comes back. -->
        <p v-if="booking.roundTrip && booking.returnPickupAt" class="booking__load">
          {{ t([`回程 ${pickup(booking.returnPickupAt)}`, returnRoute(booking)].filter(Boolean).join('・')) }}
        </p>
        <p class="booking__load">
          {{ t(loadLine(booking.passengers, booking.luggage)) }}
          <span v-if="booking.transfer" class="leg-tag">{{ t('接駁（中途換車）') }}</span>
          <span v-else-if="booking.roundTrip" class="leg-tag">{{ t('往返') }}</span>
        </p>
        <p v-if="booking.notes" class="booking__note">{{ t(booking.notes) }}</p>
        <p v-if="booking.driverName" class="hint booking__driver">{{ t(`預約 ${booking.driverName} 的車`) }}</p>
      </section>

      <section v-if="booking.quote && booking.status !== 'CANCELLED' && booking.status !== 'DECLINED'" class="card">
        <span class="section-label">{{ booking.deal ? t('特價（整車）') : t('司機的報價') }}</span>
        <strong class="booking__price">{{ money(booking.quote) }}</strong>
        <p v-if="booking.quoteNote" class="booking__load">{{ t(booking.quoteNote) }}</p>
        <p class="hint">{{ t('車費由你和司機自行約定並直接支付給司機，平台不收款。') }}</p>
        <button v-if="booking.status === 'QUOTED'" class="button block large" type="button" :disabled="busy" @click="act('accept')">
          {{ t('同意這個報價') }}
        </button>
      </section>

      <a v-if="booking.confirmUrl" class="button block large booking__next" :href="booking.confirmUrl">{{ t('查看司機與車牌，確認行程') }}</a>

      <button v-if="bookingOpen(booking.status)" class="booking__cancel" type="button" :disabled="busy" @click="act('cancel', '確定取消這個預約？')">
        {{ t('取消預約') }}
      </button>
      <!-- 特價車: back to the deal, which says whether it is still open. -->
      <RouterLink v-else-if="booking.deal && booking.status !== 'ORDERED'" class="button secondary block" :to="`/d/${booking.deal.code}`">
        {{ t('回到特價車') }}
      </RouterLink>
      <RouterLink v-else-if="booking.pageCode && booking.status !== 'ORDERED'" class="button secondary block" :to="`/p/${booking.pageCode}`">
        {{ t('再預約一次') }}
      </RouterLink>
    </template>
  </div>
</template>

<style scoped>
.booking__sent {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
}
.booking__waiting {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.booking__waiting strong {
  font-size: var(--font-body-large);
}
.booking__waiting .hint {
  margin: var(--space-xs) 0 0;
}
.booking__trip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.booking__status {
  margin-bottom: var(--space-xs);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  font-size: var(--font-caption);
  font-weight: 700;
}
.booking__status--waiting {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.booking__status--passenger {
  background: var(--color-tint);
  color: var(--color-primary-dark);
}
.booking__status--done {
  background: var(--status-confirmed-tint);
  color: var(--status-confirmed);
}
.booking__status--closed {
  background: var(--color-divider);
  color: var(--color-text-secondary);
}
.booking__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.booking__route {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.booking__load {
  margin: 0;
  color: var(--color-text-secondary);
}
.booking__note {
  align-self: stretch;
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.booking__driver {
  margin: var(--space-xs) 0 0;
}
.booking__price {
  display: block;
  margin-bottom: var(--space-xs);
  color: var(--color-gold-ink);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.booking__next {
  margin-bottom: var(--space-md);
}
.booking__cancel {
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
