<script setup lang="ts">
import { t } from '../i18n';

/**
 * 上車 → 途經 → 目的地 as dots on a line: green for 上車 and yellow for 目的地,
 * the colours of Master Travel's passenger order pages. 包車 reads 上車 → 行程 → 結束.
 */
defineProps<{ origin: string; destination: string; waypoints?: string[]; charter?: boolean }>();
</script>

<template>
  <ol class="route-points">
    <li class="route-points__point route-points__point--origin">
      <span class="route-points__label">{{ t('上車') }}</span>
      <strong>{{ t(origin) }}</strong>
    </li>
    <li v-for="(stop, index) in waypoints ?? []" :key="index" class="route-points__point route-points__point--stop">
      <span class="route-points__label">{{ charter ? t('行程') : t('途經') }}</span>
      <strong>{{ t(stop) }}</strong>
    </li>
    <li class="route-points__point route-points__point--destination">
      <span class="route-points__label">{{ charter ? t('結束') : t('目的地') }}</span>
      <strong>{{ t(destination) }}</strong>
    </li>
  </ol>
</template>

<style scoped>
.route-points {
  list-style: none;
  margin: 0;
  padding: 0;
}
.route-points__point {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 var(--space-lg) 30px;
}
.route-points__point:last-child {
  padding-bottom: 0;
}
/* The dot, 18px like the passenger app's origin and destination marks. */
.route-points__point::before {
  content: '';
  position: absolute;
  left: 0;
  top: 2px;
  width: 14px;
  height: 14px;
  margin: 2px;
  border-radius: 50%;
  background: var(--color-route-origin);
}
.route-points__point--stop::before {
  width: 8px;
  height: 8px;
  margin: 5px;
  background: var(--color-text-muted);
}
.route-points__point--destination::before {
  background: var(--color-route-destination);
}
/* The line joining one dot to the next. */
.route-points__point:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 8px;
  top: 22px;
  bottom: 2px;
  border-left: 2px dotted var(--color-border);
}
.route-points__label {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  line-height: 1.4;
}
.route-points__point strong {
  font-size: var(--font-body-large);
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.route-points__point--stop strong {
  font-size: var(--font-body);
  font-weight: 400;
}
</style>
