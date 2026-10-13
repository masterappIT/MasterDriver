<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import { BOOKING_STATUS, bookingOpen, bookingTone, type DriverBooking } from '../booking';
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
      <!-- The request as one short story: when, where, who, then what they wrote. -->
      <section class="card booking-detail__trip">
        <span class="booking-detail__status" :class="`booking-detail__status--${bookingTone(booking.status)}`">{{ t(BOOKING_STATUS[booking.status].driver) }}</span>
        <strong class="booking-detail__time">{{ pickup(booking.pickupAt) }}</strong>
        <div class="booking-detail__route">{{ t(`${booking.origin} 至 ${booking.destination}`) }}</div>
        <p class="booking-detail__load">{{ t(`${booking.passengers}人｜${booking.luggage}件行李`) }}</p>
        <p v-if="booking.notes" class="booking-detail__note">{{ t(booking.notes) }}</p>
        <p class="hint">
          {{ t(`${shortTime(booking.createdAt)} 從名片頁送出`) }}<template v-if="booking.source">{{ t(`・來自${booking.source}`) }}</template>
        </p>
      </section>

      <section class="card booking-detail__passenger">
        <div>
          <span class="section-label">{{ booking.passengerName ? t(booking.passengerName) : t('乘客') }}</span>
          <strong class="booking-detail__contact">{{ booking.passengerContact }}</strong>
        </div>
        <button class="button secondary" type="button" @click="copy(booking.passengerContact)">{{ t('複製') }}</button>
      </section>
      <p class="hint booking-detail__tip">{{ t('乘客不一定會回來看預約連結，報價後最好也直接聯絡對方。') }}</p>

      <form v-if="open" class="card" @submit.prevent="sendQuote">
        <span class="section-label">{{ booking.quote ? t('修改報價') : t('你的報價') }}</span>
        <div class="booking-detail__price">
          <select v-model="quote.currency" class="booking-detail__currency" :aria-label="t('幣種')">
            <option value="HKD">HK$</option>
            <option value="CNY">RMB¥</option>
            <option value="MOP">MOP$</option>
          </select>
          <input
            v-model="quote.amount"
            class="booking-detail__amount"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            :aria-label="t('車費')"
            :placeholder="t('車費')"
            required
          />
        </div>
        <input v-model="quote.note" class="booking-detail__quote-note" maxlength="300" :aria-label="t('說明')" :placeholder="t('說明（選填），如：已含過關費')" />
        <button class="button block" type="submit" :disabled="busy">{{ booking.quote ? t('更新報價') : t('送出報價') }}</button>
      </form>
      <section v-else-if="booking.quote" class="card">
        <span class="section-label">{{ t('你的報價') }}</span>
        <strong class="booking-detail__quoted">{{ money(booking.quote) }}</strong>
        <p v-if="booking.quoteNote" class="booking-detail__load">{{ t(booking.quoteNote) }}</p>
      </section>

      <template v-if="open">
        <RouterLink class="button block large booking-detail__order" :to="`/app/new?booking=${booking.id}`">{{ t('成單：帶入出單表格') }}</RouterLink>
        <p class="hint booking-detail__tip">{{ t('和乘客談好後按「成單」。之後可以自己做，或派到群裡。') }}</p>
        <button class="booking-detail__decline" type="button" :disabled="busy" @click="decline">{{ t('婉拒這個預約') }}</button>
      </template>
      <RouterLink v-else-if="booking.orderId" class="button block" :to="`/app/orders/${booking.orderId}`">{{ t('查看這張單') }}</RouterLink>
    </template>
  </div>
</template>

<style scoped>
.booking-detail__trip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.booking-detail__status {
  margin-bottom: var(--space-xs);
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  font-size: var(--font-caption);
  font-weight: 700;
}
.booking-detail__status--waiting {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.booking-detail__status--passenger {
  background: var(--color-tint);
  color: var(--color-primary-dark);
}
.booking-detail__status--done {
  background: var(--status-confirmed-tint);
  color: var(--status-confirmed);
}
.booking-detail__status--closed {
  background: var(--color-divider);
  color: var(--color-text-secondary);
}
.booking-detail__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.booking-detail__route {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.booking-detail__load {
  margin: 0;
  color: var(--color-text-secondary);
}
.booking-detail__note {
  align-self: stretch;
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.booking-detail__trip .hint {
  margin: var(--space-xs) 0 0;
}
.booking-detail__passenger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
}
.booking-detail__passenger .section-label {
  margin-bottom: 0;
}
.booking-detail__contact {
  font-size: 18px;
  overflow-wrap: anywhere;
}
.booking-detail__tip {
  margin: 0 var(--space-xs) var(--space-lg);
}
/* The price reads like the price on a claim page: a currency capsule, then the number on a line. */
.booking-detail__price {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
  border-bottom: 2px solid var(--color-border);
}
.booking-detail__price:focus-within {
  border-bottom-color: var(--color-primary);
}
.booking-detail__currency {
  min-height: 34px;
  padding: 0 var(--space-sm);
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  font: inherit;
  font-weight: 700;
}
.booking-detail__amount {
  flex: 1;
  min-width: 0;
  min-height: 52px;
  border: none;
  background: transparent;
  color: var(--color-gold-ink);
  font: inherit;
  font-size: 28px;
  font-weight: 800;
  outline: none;
}
.booking-detail__quote-note {
  width: 100%;
  min-height: 44px;
  margin-bottom: var(--space-lg);
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 16px;
  outline: none;
}
.booking-detail__quote-note:focus {
  border-bottom-color: var(--color-primary);
}
.booking-detail__quoted {
  color: var(--color-gold-ink);
  font-size: 24px;
}
.booking-detail__order {
  margin-bottom: var(--space-sm);
}
.booking-detail__decline {
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
