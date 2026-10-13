<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import { BOOKING_STATUS, bookingOpen, type Booking } from '../booking';
import { copyText } from '../device';
import { money, pickup } from '../format';
import { t } from '../i18n';
import { toast } from '../toast';

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

onMounted(async () => {
  await load();
  // The driver answers later: keep the page current while it is open.
  poller = setInterval(() => {
    if (!document.hidden && booking.value && bookingOpen(booking.value.status)) void load();
  }, POLL_MS);
});
onBeforeUnmount(() => clearInterval(poller));
</script>

<template>
  <div class="page">
    <h1>{{ t('我的預約') }}</h1>
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="booking">
      <div v-if="justSent" class="notice">
        {{ t('預約已送出。請保存這個頁面的連結，司機回覆後在這裡看得到；司機也可能直接用你留的聯絡方式找你。') }}
        <button class="chip booking__copy" type="button" @click="copyLink">{{ t('複製連結') }}</button>
      </div>

      <section class="card">
        <p class="booking__status">{{ t(BOOKING_STATUS[booking.status].passenger) }}</p>
        <strong>{{ pickup(booking.pickupAt) }}</strong>
        <div>{{ t(`${booking.origin} 至 ${booking.destination}`) }}</div>
        <p class="muted">{{ t(`${booking.passengers} 人・${booking.luggage} 件行李`) }}</p>
        <p v-if="booking.notes">{{ t(`備註：${booking.notes}`) }}</p>
        <p class="hint">{{ t(`司機：${booking.driverName ?? '—'}`) }}</p>
      </section>

      <section v-if="booking.quote && booking.status !== 'CANCELLED' && booking.status !== 'DECLINED'" class="card">
        <h2>{{ t('司機的報價') }}</h2>
        <p class="booking__price">{{ money(booking.quote) }}</p>
        <p v-if="booking.quoteNote">{{ t(booking.quoteNote) }}</p>
        <p class="hint">{{ t('車費由你和司機自行約定並直接支付給司機，平台不收款。') }}</p>
        <button v-if="booking.status === 'QUOTED'" class="button block large" type="button" :disabled="busy" @click="act('accept')">
          {{ t('同意這個報價') }}
        </button>
      </section>

      <a v-if="booking.confirmUrl" class="button block large booking__next" :href="booking.confirmUrl">{{ t('查看司機與車牌，確認行程') }}</a>

      <button
        v-if="bookingOpen(booking.status)"
        class="button secondary block"
        type="button"
        :disabled="busy"
        @click="act('cancel', '確定取消這個預約？')"
      >
        {{ t('取消預約') }}
      </button>
      <RouterLink v-else-if="booking.pageCode && booking.status !== 'ORDERED'" class="button secondary block" :to="`/p/${booking.pageCode}`">
        {{ t('再預約一次') }}
      </RouterLink>
    </template>
  </div>
</template>

<style scoped>
.booking__status {
  margin: 0 0 var(--space-md);
  font-weight: 600;
  color: var(--color-primary-dark);
}
.booking__price {
  margin: 0 0 var(--space-sm);
  font-size: 28px;
  font-weight: 700;
}
.booking__copy {
  margin-left: var(--space-sm);
}
.booking__next {
  margin-bottom: var(--space-md);
}
</style>
