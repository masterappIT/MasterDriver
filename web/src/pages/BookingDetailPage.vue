<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import { BOOKING_STATUS, bookingOpen, type DriverBooking } from '../booking';
import { copyText } from '../device';
import { money, pickup, shortTime } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { toast } from '../toast';

/** One booking request: the driver quotes a price or declines, and makes it into an order once agreed. */
const route = useRoute();
const id = String(route.params.id);
const booking = ref<DriverBooking | null>(null);
const error = ref('');
const busy = ref(false);
const quote = reactive({ amount: '', currency: 'HKD', note: '' });
const open = computed(() => (booking.value ? bookingOpen(booking.value.status) : false));

function fill(loaded: DriverBooking) {
  booking.value = loaded;
  if (loaded.quote) {
    quote.amount = String(loaded.quote.amount);
    quote.currency = loaded.quote.currency;
    quote.note = loaded.quoteNote ?? '';
  }
}

async function run(action: () => Promise<DriverBooking>, done: string) {
  error.value = '';
  busy.value = true;
  try {
    fill(await action());
    toast(done);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

const sendQuote = () =>
  run(
    () => api<DriverBooking>('POST', `/me/bookings/${id}/quote`, { amount: Number(quote.amount), currency: quote.currency, note: quote.note }),
    '報價已送出，乘客打開預約連結就看得到',
  );

function decline() {
  if (!confirm(t('確定婉拒這個預約？乘客會在預約連結看到。'))) return;
  return run(() => api<DriverBooking>('POST', `/me/bookings/${id}/decline`), '已婉拒');
}

async function copy(text: string) {
  toast((await copyText(text)) ? '已複製' : '複製失敗，請長按文字自行複製');
}

onMounted(async () => {
  try {
    fill(await api<DriverBooking>('GET', `/me/bookings/${id}`));
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('預約詳情')" fallback="/app/bookings" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="booking">
      <section class="card">
        <p class="booking-detail__status">{{ t(BOOKING_STATUS[booking.status].driver) }}</p>
        <strong>{{ pickup(booking.pickupAt) }}</strong>
        <div class="booking-detail__route">{{ t(`${booking.origin} 至 ${booking.destination}`) }}</div>
        <p class="muted">{{ t(`${booking.passengers}人・${booking.luggage}件行李`) }}</p>
        <p v-if="booking.notes">{{ t(`備註：${booking.notes}`) }}</p>
        <p class="hint">
          {{ t(`${shortTime(booking.createdAt)} 送出`) }}<template v-if="booking.source">・{{ t(`來源：${booking.source}`) }}</template>
        </p>
      </section>

      <section class="card">
        <h2>{{ t('乘客') }}</h2>
        <p>{{ booking.passengerName ?? t('乘客') }}：<strong>{{ booking.passengerContact }}</strong></p>
        <button class="button secondary" type="button" @click="copy(booking.passengerContact)">{{ t('複製聯絡方式') }}</button>
        <p class="hint">{{ t('乘客不一定會回來看這個頁面，報價後最好也直接聯絡對方。') }}</p>
      </section>

      <form v-if="open" class="card" @submit.prevent="sendQuote">
        <h2>{{ booking.quote ? t('修改報價') : t('回覆報價') }}</h2>
        <div class="row">
          <label class="field booking-detail__currency">
            {{ t('幣種') }}
            <select v-model="quote.currency" class="select">
              <option value="HKD">HK$</option>
              <option value="CNY">RMB¥</option>
              <option value="MOP">MOP$</option>
            </select>
          </label>
          <label class="field booking-detail__amount">
            {{ t('車費') }}
            <input v-model="quote.amount" class="input" type="number" min="0" step="0.01" inputmode="decimal" required />
          </label>
        </div>
        <label class="field">{{ t('說明（選填）') }}<input v-model="quote.note" class="input" maxlength="300" :placeholder="t('例如：已含隧道費和過關費')" /></label>
        <button class="button block" type="submit" :disabled="busy">{{ booking.quote ? t('更新報價') : t('送出報價') }}</button>
      </form>
      <section v-else-if="booking.quote" class="card">
        <h2>{{ t('報價') }}</h2>
        <p>{{ money(booking.quote) }}<template v-if="booking.quoteNote">　{{ t(booking.quoteNote) }}</template></p>
      </section>

      <template v-if="open">
        <RouterLink class="button block large booking-detail__order" :to="`/app/new?booking=${booking.id}`">{{ t('成單：帶入出單表格') }}</RouterLink>
        <p class="hint">{{ t('和乘客談好後按「成單」。之後可以自己做，或派到群裡。') }}</p>
        <button class="button secondary block" type="button" :disabled="busy" @click="decline">{{ t('婉拒') }}</button>
      </template>
      <RouterLink v-else-if="booking.orderId" class="button block" :to="`/app/orders/${booking.orderId}`">{{ t('查看這張單') }}</RouterLink>
    </template>
  </div>
</template>

<style scoped>
.booking-detail__status {
  margin: 0 0 var(--space-md);
  font-weight: 600;
  color: var(--color-primary-dark);
}
.booking-detail__route {
  font-size: var(--font-body-large);
}
.booking-detail__currency {
  width: 100px;
}
.booking-detail__amount {
  flex: 1;
  min-width: 0;
}
.booking-detail__order {
  margin-bottom: var(--space-sm);
}
</style>
