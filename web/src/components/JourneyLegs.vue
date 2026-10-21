<script setup lang="ts">
import { legName, type Journey, type JourneyLeg } from '../journey';
import { pickup, plateKind } from '../format';
import { t } from '../i18n';
import PlateTag from './PlateTag.vue';
import StatusBadge from './StatusBadge.vue';

/**
 * 接駁: both legs of the order, with the 接駁位置 between them. 往返: the way there and the way
 * back, nothing between them. The dispatcher opens a leg to manage its driver; each leg's driver
 * sees the other's.
 */
withDefaults(defineProps<{ legs: JourneyLeg[]; current: number; kind?: Journey['kind'] }>(), { kind: 'TRANSFER' });
</script>

<template>
  <ol class="journey-legs">
    <li v-for="leg in legs" :key="leg.legIndex" class="journey-legs__item">
      <p v-if="leg.legIndex > 1 && kind !== 'ROUND_TRIP'" class="journey-legs__handoff"><span>{{ t(`接駁位置：${leg.origin}`) }}</span></p>
      <component
        :is="leg.id && leg.legIndex !== current ? 'RouterLink' : 'div'"
        :to="leg.id ? `/app/orders/${leg.id}` : undefined"
        class="journey-legs__leg"
        :class="{ 'journey-legs__leg--current': leg.legIndex === current, 'journey-legs__leg--cancelled': leg.status === 'CANCELLED' }"
      >
        <div class="journey-legs__top">
          <span class="leg-tag">{{ t(legName(kind, leg.legIndex)) }}<template v-if="leg.legIndex === current">・{{ t(kind === 'ROUND_TRIP' ? '本程' : '本段') }}</template></span>
          <StatusBadge :status="leg.status" />
        </div>
        <div class="journey-legs__time">{{ pickup(leg.pickupAt) }}<span v-if="leg.immediate" class="now-tag journey-legs__now">{{ t('即時') }}</span></div>
        <div v-if="leg.selfDrive" class="hint">{{ t('出單者自己開') }}</div>
        <div>{{ t(`${leg.origin} 至 ${leg.destination}`) }}</div>
        <div v-if="leg.driver && leg.legIndex !== current" class="journey-legs__driver">
          <span>{{ leg.driver.name ? t(leg.driver.name) : t('司機') }}</span>
          <PlateTag :hk="leg.driver.hkPlate" :macau="leg.driver.macauPlate" :mainland="leg.driver.mainlandPlate" />
          <span v-if="leg.driver.color || plateKind(leg.driver)" class="hint">{{ [leg.driver.color, plateKind(leg.driver)].filter(Boolean).map((part) => t(part as string)).join(' · ') }}</span>
          <a v-if="leg.driver.phone" :href="`tel:${leg.driver.phone.replace(/\s/g, '')}`" @click.stop>{{ leg.driver.phone }}</a>
        </div>
        <div v-else-if="leg.driver === null && leg.status === 'OPEN'" class="hint">{{ t('等待司機搶單') }}</div>
        <div v-else-if="leg.driverDeleted" class="hint">{{ t('接單司機：司機已刪除') }}</div>
      </component>
    </li>
  </ol>
</template>

<style scoped>
.journey-legs {
  list-style: none;
  margin: 0;
  padding: 0;
}
/*
 * Where one leg hands over to the next, usually a 口岸: drawn as the border it is, a dashed line
 * across with the place in a teal pill, so a cross-border trip reads as two sides of a crossing.
 */
.journey-legs__handoff {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: var(--space-sm) 0;
  color: var(--color-teal);
  font-size: var(--font-label);
  font-weight: 700;
  text-align: center;
}
.journey-legs__handoff::before,
.journey-legs__handoff::after {
  content: '';
  flex: 1 1 0;
  border-top: 2px dashed rgba(14, 159, 154, 0.45);
}
.journey-legs__handoff > span {
  padding: 2px 12px;
  border-radius: var(--radius-pill);
  background: rgba(14, 159, 154, 0.1);
}
.journey-legs__leg {
  display: block;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-input);
  padding: var(--space-sm) var(--space-md);
  color: var(--color-text);
}
.journey-legs__leg--current {
  border-color: var(--color-primary);
  background: var(--color-tint);
}
.journey-legs__leg--cancelled {
  opacity: 0.6;
}
.journey-legs__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.journey-legs__time {
  font-weight: 600;
  margin-top: var(--space-xs);
}
.journey-legs__now {
  margin-left: var(--space-xs);
}
.journey-legs__driver {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
  margin-top: var(--space-xs);
}
.journey-legs__item + .journey-legs__item {
  margin-top: var(--space-xs);
}
</style>
