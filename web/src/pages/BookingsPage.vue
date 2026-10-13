<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import { BOOKING_STATUS, bookingTone, type DriverBooking } from '../booking';
import { pickup, shortTime } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';

/** Booking requests passengers sent from the driver's 名片頁, newest first. */
const bookings = ref<DriverBooking[] | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    bookings.value = await api<DriverBooking[]>('GET', '/me/bookings');
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('預約')" fallback="/app/me" />
    <div v-if="error" class="notice error">{{ error }}</div>
    <p v-if="bookings && bookings.length === 0" class="bookings__empty">
      {{ t('還沒有預約。把名片頁的連結放到朋友圈、小紅書或傳給熟客，乘客就可以在上面預約。') }}
      <RouterLink to="/app/profile-page">{{ t('打開我的名片頁') }}</RouterLink>
    </p>
    <RouterLink v-for="booking in bookings ?? []" :key="booking.id" :to="`/app/bookings/${booking.id}`" class="card bookings__item">
      <div class="bookings__top">
        <strong class="bookings__time">{{ pickup(booking.pickupAt) }}</strong>
        <span class="bookings__status" :class="`bookings__status--${bookingTone(booking.status)}`">
          <span v-if="booking.unread" class="bookings__dot" :aria-label="t('未讀')"></span>{{ t(BOOKING_STATUS[booking.status].driver) }}
        </span>
      </div>
      <div class="bookings__route">{{ t(`${booking.origin} 至 ${booking.destination}`) }}</div>
      <div class="bookings__meta">
        {{ t(`${booking.passengerName ?? '乘客'}｜${booking.passengers}人｜${booking.luggage}件行李`) }}
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
