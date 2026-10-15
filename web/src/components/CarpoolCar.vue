<script setup lang="ts">
import type { CarpoolCar } from '../carpool';
import { plateKind } from '../format';
import { t } from '../i18n';
import ContactLines from './ContactLines.vue';
import PlateTag from './PlateTag.vue';

/**
 * The car a 拼車 passenger looks for: who drives, the vehicle and its photo, the plates unless
 * the driver keeps them from passengers, and how to reach the driver when the page may say.
 */
defineProps<{ car: CarpoolCar; showPlates?: boolean }>();

const vehicleLine = (car: CarpoolCar) => {
  const seats = car.seats ? `${car.seats}座` : '';
  return [car.vehicleType, car.vehicleType?.includes(seats) ? '' : seats, car.color, plateKind(car)].filter(Boolean).join('・');
};
</script>

<template>
  <div class="carpool-car">
    <div v-if="car.photos.length" class="carpool-car__photos">
      <img v-for="photo in car.photos" :key="photo" :src="photo" :alt="t('司機的車')" loading="lazy" />
    </div>
    <strong class="carpool-car__name">{{ car.name ? t(car.name) : t('司機') }}</strong>
    <span class="carpool-car__vehicle">{{ t(vehicleLine(car)) }}</span>
    <span v-if="car.completedTrips > 0" class="carpool-car__trips">{{ t(`已在師傅幫完成 ${car.completedTrips} 張單`) }}</span>
    <template v-if="showPlates">
      <p v-if="car.platesHidden" class="carpool-car__no-plate">{{ t('司機沒有公開車牌。上車前請先打給司機，確認是哪一輛車。') }}</p>
      <div v-else class="carpool-car__plates"><PlateTag :hk="car.hkPlate" :macau="car.macauPlate" :mainland="car.mainlandPlate" /></div>
    </template>
    <ContactLines v-if="car.phones.length || car.wechatId || car.whatsapp" :phones="car.phones" :wechat-id="car.wechatId" :whatsapp="car.whatsapp" />
    <RouterLink v-if="car.pageCode" class="carpool-car__page" :to="`/p/${car.pageCode}`">{{ t('看司機的名片頁') }}</RouterLink>
  </div>
</template>

<style scoped>
.carpool-car {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.carpool-car__photos {
  display: flex;
  width: 100%;
  margin-bottom: var(--space-sm);
}
.carpool-car__photos img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--radius-input);
  background: var(--color-tint);
}
.carpool-car__name {
  font-size: 20px;
}
.carpool-car__vehicle,
.carpool-car__trips {
  color: var(--color-text-secondary);
}
.carpool-car__plates {
  margin: var(--space-sm) 0;
  font-size: 22px;
}
.carpool-car__no-plate {
  margin: var(--space-xs) 0;
  color: var(--color-gold-ink);
}
.carpool-car__page {
  margin-top: var(--space-xs);
  font-weight: 600;
}
</style>
