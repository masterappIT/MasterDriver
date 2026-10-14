<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatPassengerPhone, isValidPassengerPhone, splitPassengerPhone, type CountryCode } from '@masterdriver/shared/phone';
import { api, errorText } from '../api';
import { BOOKING_STATUS, bookingOpen, bookingTone, type DriverBooking } from '../booking';
import { copyText } from '../device';
import { loadLine, money, pickup, shortTime } from '../format';
import PageBack from '../components/PageBack.vue';
import PhoneField from '../components/PhoneField.vue';
import { t } from '../i18n';
import { toast } from '../toast';

/** One booking request: the driver quotes a price or declines, and makes it into an order once agreed. */
const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const booking = ref<DriverBooking | null>(null);
const error = ref('');
const busy = ref(false);
/** The quote starts in 人民幣, as an order's prices do. */
const quote = reactive({ amount: '', currency: 'CNY', note: '' });
const open = computed(() => (booking.value ? bookingOpen(booking.value.status) : false));
/** Once the passenger has agreed, the agreed price stands; the server refuses a new quote too. */
const quotable = computed(() => booking.value?.status === 'PENDING' || booking.value?.status === 'QUOTED');

/**
 * Requests sent before 2026-10-14 may hold a WeChat ID or any text instead of a phone. The driver
 * adds the phone here, and both ways of making the order use it.
 */
const contactPhone = computed(() => (booking.value ? splitPassengerPhone(booking.value.passengerContact) : null));
const added = reactive({ country: '+852' as CountryCode, phone: '' });

/** The phone to make the order with, or null (with the reason shown) when the one typed is not valid. */
function orderPhone(): string | null {
  if (contactPhone.value) return formatPassengerPhone(contactPhone.value.countryCode, contactPhone.value.phone);
  if (isValidPassengerPhone(added.country, added.phone)) return formatPassengerPhone(added.country, added.phone);
  error.value = t(added.country === '+86' ? '請先補上乘客電話：11 位內地手機號碼' : '請先補上乘客電話：8 位數字');
  document.getElementById('booking-added-phone')?.focus();
  return null;
}

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

/**
 * 這單我自己做: the request already says when, where, who and (once quoted) how much, so it becomes
 * the driver's own trip in one step, with nothing to type again but a missing phone.
 */
async function driveMyself() {
  const b = booking.value;
  if (!b) return;
  error.value = '';
  const passengerContact = orderPhone();
  if (!passengerContact) return;
  busy.value = true;
  try {
    const created = await api<{ id: string }>('POST', '/orders', {
      pickupAt: b.pickupAt,
      origin: b.origin,
      destination: b.destination,
      passengers: b.passengers,
      luggage: b.luggage,
      passengerName: b.passengerName ?? undefined,
      passengerContact,
      notes: b.notes ?? undefined,
      ...(b.quote ? { passengerPrice: b.quote, showPassengerPrice: true } : {}),
      selfDrive: true,
      bookingId: b.id,
    });
    toast('已成單，這單你自己做');
    await router.replace(`/app/orders/${created.id}`);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

/** 派給其他司機: the form, with the request and a phone added here carried over (not in the address). */
function dispatchToOthers() {
  const b = booking.value;
  if (!b) return;
  error.value = '';
  const typed = !contactPhone.value && added.phone.trim();
  const passengerContact = typed ? orderPhone() : null;
  if (typed && !passengerContact) return;
  void router.push({ path: '/app/new', query: { booking: b.id }, state: passengerContact ? { passengerContact } : {} });
}

/**
 * The passenger agrees or cancels on their own link at any time, so the request is read again
 * every 10 seconds while it is open and on screen. Only the request itself is replaced: a quote
 * being typed stays as typed.
 */
const REFRESH_MS = 10_000;
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  if (document.visibilityState !== 'visible' || busy.value || !booking.value || !bookingOpen(booking.value.status)) return;
  try {
    booking.value = await api<DriverBooking>('GET', `/me/bookings/${id}`);
  } catch {
    /* keep what is on screen; the next round tries again */
  }
}

onMounted(async () => {
  try {
    fill(await api<DriverBooking>('GET', `/me/bookings/${id}`));
  } catch (e) {
    error.value = errorText(e);
  }
  timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', refresh);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', refresh);
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
        <p class="booking-detail__load">{{ t(loadLine(booking.passengers, booking.luggage)) }} <span v-if="booking.transfer" class="leg-tag">{{ t('接駁（中途換車）') }}</span></p>
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
        <a v-if="contactPhone" class="button secondary" :href="`tel:${contactPhone.countryCode}${contactPhone.phone}`">{{ t('致電') }}</a>
        <button v-else class="button secondary" type="button" @click="copy(booking.passengerContact)">{{ t('複製') }}</button>
      </section>
      <section v-if="booking.passengerWechat" class="card booking-detail__passenger">
        <div>
          <span class="section-label">{{ t('微信號') }}</span>
          <strong class="booking-detail__contact">{{ booking.passengerWechat }}</strong>
        </div>
        <button class="button secondary" type="button" @click="copy(booking.passengerWechat)">{{ t('複製') }}</button>
      </section>
      <p class="hint booking-detail__tip">{{ t('乘客不一定會回來看預約連結，報價後最好也直接聯絡對方。') }}</p>

      <form v-if="quotable" class="card" @submit.prevent="sendQuote">
        <span class="section-label">{{ booking.quote ? t('修改報價') : t('你的報價') }}</span>
        <div class="amount-line booking-detail__price">
          <select v-model="quote.currency" :aria-label="t('幣種')">
            <option value="CNY">RMB¥</option>
            <option value="HKD">HK$</option>
            <option value="MOP">MOP$</option>
          </select>
          <input
            v-model="quote.amount"
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
        <span class="section-label">{{ booking.status === 'ACCEPTED' ? t('乘客已同意的報價') : t('你的報價') }}</span>
        <strong class="booking-detail__quoted">{{ money(booking.quote) }}</strong>
        <p v-if="booking.quoteNote" class="booking-detail__load">{{ t(booking.quoteNote) }}</p>
      </section>

      <template v-if="open">
        <p v-if="booking.status === 'ACCEPTED'" class="booking-detail__agreed">{{ t('乘客已同意報價，安排行程吧') }}</p>
        <div v-if="!contactPhone" class="card booking-detail__add-phone">
          <label for="booking-added-phone" class="section-label">{{ t('乘客沒有留電話，成單前請補上') }}</label>
          <PhoneField id="booking-added-phone" v-model:country="added.country" v-model:phone="added.phone" />
        </div>
        <!-- 接駁: where the cars change and the other leg's price are the driver's to set, so it always goes through the form. -->
        <template v-if="booking.transfer">
          <button class="button block large booking-detail__order" type="button" :disabled="busy" @click="dispatchToOthers">{{ t('接駁成單') }}</button>
          <p class="hint booking-detail__tip">
            {{ t('乘客要接駁（中途換車）。帶入出單表格，填接駁位置和每段的出單價；你可以自己做其中一段，另一段貼到群裡。') }}
          </p>
        </template>
        <template v-else>
          <button class="button block large booking-detail__order" type="button" :disabled="busy" @click="driveMyself">{{ t('這單我自己做') }}</button>
          <button class="button secondary block booking-detail__order" type="button" :disabled="busy" @click="dispatchToOthers">{{ t('派給其他司機') }}</button>
          <p class="hint booking-detail__tip">
            {{ booking.status === 'ACCEPTED' ? t('自己做：直接成為你的行程，不用再填資料。派給其他司機：帶入出單表格，填出單價後貼到群裡。') : t('和乘客談好後就可以成單。自己做：直接成為你的行程；派給其他司機：帶入出單表格。') }}
          </p>
        </template>
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
  font-size: 20px;
  overflow-wrap: anywhere;
}
.booking-detail__tip {
  margin: 0 var(--space-xs) var(--space-lg);
}
.booking-detail__price {
  margin-bottom: var(--space-md);
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
  font-size: 17px;
  outline: none;
}
.booking-detail__quote-note:focus {
  border-bottom-color: var(--color-primary);
}
.booking-detail__quoted {
  color: var(--color-gold-ink);
  font-size: 24px;
}
.booking-detail__add-phone {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.booking-detail__agreed {
  margin: 0 var(--space-xs) var(--space-sm);
  color: var(--status-confirmed);
  font-weight: 700;
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
