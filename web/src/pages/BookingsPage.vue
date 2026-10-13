<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import { BOOKING_STATUS, type DriverBooking } from '../booking';
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
    <p v-if="bookings && bookings.length === 0" class="muted">
      {{ t('還沒有預約。把名片頁的連結放到朋友圈、小紅書或傳給熟客，乘客就可以在上面預約。') }}
    </p>
    <RouterLink v-for="booking in bookings ?? []" :key="booking.id" :to="`/app/bookings/${booking.id}`" class="card bookings__item">
      <div class="bookings__top">
        <strong>{{ pickup(booking.pickupAt) }}</strong>
        <span class="bookings__status" :class="{ 'bookings__status--new': booking.unread }">{{ t(BOOKING_STATUS[booking.status].driver) }}</span>
      </div>
      <div>{{ t(`${booking.origin} 至 ${booking.destination}`) }}</div>
      <div class="hint">{{ t(`${booking.passengers}人・${booking.luggage}件行李・${shortTime(booking.createdAt)} 送出`) }}</div>
    </RouterLink>
  </div>
</template>

<style scoped>
.bookings__item {
  display: block;
  color: var(--color-text);
}
.bookings__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.bookings__status {
  font-size: var(--font-label);
  color: var(--color-text-secondary);
}
.bookings__status--new {
  color: #e5484d;
  font-weight: 600;
}
</style>
