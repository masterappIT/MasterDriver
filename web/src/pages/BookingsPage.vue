<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import { bookingStatusText, bookingTone, returnRoute, type DriverBooking } from '../booking';
import { loadLine, money, pickup, shortTime } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';

/** Booking requests passengers sent from the driver's 名片頁, newest first. */
const bookings = ref<DriverBooking[] | null>(null);
const error = ref('');

async function load() {
  try {
    bookings.value = await api<DriverBooking[]>('GET', '/me/bookings');
    error.value = '';
  } catch (e) {
    if (!bookings.value) error.value = errorText(e);
  }
}

/** A passenger sends, agrees or cancels at any time: read the list again every 10 seconds while it is on screen. */
const REFRESH_MS = 10_000;
let timer: ReturnType<typeof setInterval> | undefined;

function refresh() {
  if (document.visibilityState === 'visible') void load();
}

onMounted(() => {
  void load();
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
    <PageBack :title="t('等我報價')" fallback="/app/me" />
    <div v-if="error" class="notice error">{{ error }}</div>
    <p v-if="bookings && bookings.length === 0" class="bookings__empty">
      {{ t('還沒有客人詢價。把名片頁的連結放到朋友圈、小紅書或傳給熟客，客人就可以在上面向你問價。') }}
      <RouterLink to="/guide/profile-page">{{ t('看教學：怎麼用名片頁找客人') }}</RouterLink>
      <RouterLink to="/app/profile-page">{{ t('打開我的名片頁') }}</RouterLink>
    </p>
    <RouterLink v-for="booking in bookings ?? []" :key="booking.id" :to="`/app/bookings/${booking.id}`" class="card bookings__item">
      <div class="bookings__top">
        <strong class="bookings__time">{{ pickup(booking.pickupAt) }}</strong>
        <span class="bookings__status" :class="`bookings__status--${bookingTone(booking.status)}`">
          <span v-if="booking.unread" class="bookings__dot" :aria-label="t('未讀')"></span>{{ t(bookingStatusText(booking, 'driver')) }}
        </span>
      </div>
      <div class="bookings__route">{{ t(`${booking.origin} 至 ${booking.destination}`) }}</div>
      <span v-if="booking.deal" class="leg-tag bookings__tag">{{ t(`特價車・${money(booking.quote)}`) }}</span>
      <span v-else-if="booking.transfer" class="leg-tag bookings__tag">{{ t('接駁（中途換車）') }}</span>
      <span v-else-if="booking.roundTrip" class="leg-tag bookings__tag">
        {{ t([booking.returnPickupAt ? `往返・回程 ${pickup(booking.returnPickupAt)}` : '往返', returnRoute(booking)].filter(Boolean).join('・')) }}
      </span>
      <div class="bookings__meta">
        {{ t(`${booking.passengerName ?? '乘客'}｜${loadLine(booking.passengers, booking.luggage)}`) }}
        <span>{{ t(`${shortTime(booking.createdAt)} 送出`) }}</span>
      </div>
    </RouterLink>
  </div>
</template>

<style scoped>
.bookings__empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  color: var(--color-text-secondary);
}
.bookings__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--color-text);
}
.bookings__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}
.bookings__time {
  font-variant-numeric: tabular-nums;
}
.bookings__route {
  font-size: var(--font-body-large);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.bookings__tag {
  align-self: flex-start;
}
.bookings__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.bookings__meta span {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}
.bookings__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  font-size: var(--font-caption);
  font-weight: 700;
  white-space: nowrap;
}
.bookings__status--waiting {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.bookings__status--passenger {
  background: var(--color-tint);
  color: var(--color-primary-dark);
}
.bookings__status--done {
  background: var(--status-confirmed-tint);
  color: var(--status-confirmed);
}
.bookings__status--closed {
  background: var(--color-divider);
  color: var(--color-text-secondary);
}
.bookings__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-error);
}
</style>
