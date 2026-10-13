<script setup lang="ts">
import type { JourneyLeg } from '../journey';
import { pickup } from '../format';
import { t } from '../i18n';
import PlateTag from './PlateTag.vue';
import StatusBadge from './StatusBadge.vue';

/**
 * 接駁: every leg of the trip in order, with the 接駁位置 between them. The
 * dispatcher can open each leg; drivers see the other legs' drivers.
 */
defineProps<{ legs: JourneyLeg[]; current: number }>();
</script>

<template>
  <ol class="journey-legs">
    <li v-for="leg in legs" :key="leg.legIndex" class="journey-legs__item">
      <p v-if="leg.legIndex > 1" class="journey-legs__handoff">{{ t(`接駁位置：${leg.origin}`) }}</p>
      <component
        :is="leg.id && leg.legIndex !== current ? 'RouterLink' : 'div'"
        :to="leg.id ? `/app/orders/${leg.id}` : undefined"
        class="journey-legs__leg"
        :class="{ 'journey-legs__leg--current': leg.legIndex === current, 'journey-legs__leg--cancelled': leg.status === 'CANCELLED' }"
      >
        <div class="journey-legs__top">
          <span class="leg-tag">{{ t(`第 ${leg.legIndex} 段`) }}<template v-if="leg.legIndex === current">・{{ t('本段') }}</template></span>
          <StatusBadge :status="leg.status" />
        </div>
        <div class="journey-legs__time">{{ pickup(leg.pickupAt) }}</div>
        <div>{{ t(`${leg.origin} 至 ${leg.destination}`) }}</div>
        <div v-if="leg.driver && leg.legIndex !== current" class="journey-legs__driver">
          <span>{{ leg.driver.name ? t(leg.driver.name) : t('司機') }}</span>
          <PlateTag :hk="leg.driver.hkPlate" :macau="leg.driver.macauPlate" :mainland="leg.driver.mainlandPlate" />
          <span v-if="leg.driver.color" class="hint">{{ t(leg.driver.color) }}</span>
          <a v-if="leg.driver.phone" :href="`tel:${leg.driver.phone.replace(/\s/g, '')}`" @click.stop>{{ leg.driver.phone }}</a>
        </div>
        <div v-else-if="leg.driver === null && leg.status === 'OPEN'" class="hint">{{ t('等待司機搶單') }}</div>
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
.journey-legs__handoff {
  margin: var(--space-xs) 0 var(--space-xs) var(--space-md);
  color: var(--color-text-secondary);
  font-size: var(--font-label);
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
