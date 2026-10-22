<script setup lang="ts">
import { CHARTER_EXTRAS, CHARTER_EXTRA_NAMES, charterHours, overtimeCount, type CharterExtra } from '@masterdriver/shared/charter';
import { computed } from 'vue';
import { money, pickup, type Money } from '../format';
import { t } from '../i18n';

/**
 * 包鐘 (按小時計費): the hours booked, the price an hour this viewer may see with what the hours come
 * to, and the dispatcher's 超時 and 另計 rules, as the group text states them. Nothing here is worked
 * out by the platform beyond the hours times the price an hour.
 */
const props = defineProps<{
  minutes: number;
  /** When the hours start; the end is said from it. Left out for 即時單, which starts when put out. */
  start?: string | null;
  hourly: Money;
  total: Money;
  overtimeHourly: Money;
  overtimeUnitMinutes: number;
  overtimeGraceMinutes: number;
  extras: CharterExtra[];
}>();

const end = computed(() => (props.start ? pickup(new Date(new Date(props.start).getTime() + props.minutes * 60_000).toISOString()) : null));
const overtime = computed(() => {
  const count = overtimeCount(props.overtimeUnitMinutes, props.overtimeGraceMinutes);
  return props.overtimeHourly ? `每小時 ${money(props.overtimeHourly)}，${count}` : count;
});
/** Under the 另計 heading, the costs alone: "路橋費、停車費". */
const extras = computed(() =>
  CHARTER_EXTRAS.filter((extra) => props.extras.includes(extra))
    .map((extra) => CHARTER_EXTRA_NAMES[extra])
    .join('、'),
);
</script>

<template>
  <dl class="charter-rules">
    <div>
      <dt>{{ t('包鐘') }}</dt>
      <dd>{{ end ? t(`${charterHours(minutes)}，到 ${end}`) : t(charterHours(minutes)) }}</dd>
    </div>
    <div v-if="hourly">
      <dt>{{ t('每小時') }}</dt>
      <dd>{{ total ? t(`${money(hourly)}，共 ${money(total)}`) : money(hourly) }}</dd>
    </div>
    <div>
      <dt>{{ t('超時') }}</dt>
      <dd>{{ t(overtime) }}</dd>
    </div>
    <div v-if="extras">
      <dt>{{ t('另計') }}</dt>
      <dd>{{ t(extras) }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.charter-rules {
  display: grid;
  gap: var(--space-xs);
  margin: var(--space-md) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-tint);
}
.charter-rules > div {
  display: flex;
  gap: var(--space-sm);
}
.charter-rules dt {
  flex-shrink: 0;
  min-width: 3.5em;
  color: var(--color-text-secondary);
}
.charter-rules dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
</style>
