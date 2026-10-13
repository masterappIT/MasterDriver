<script lang="ts">
const OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '搶到即顯示' },
  { value: 30, label: '出發前 30 分鐘' },
  { value: 60, label: '出發前 1 小時' },
  { value: 120, label: '出發前 2 小時' },
  { value: 180, label: '出發前 3 小時' },
  { value: 360, label: '出發前 6 小時' },
  { value: 720, label: '出發前 12 小時' },
  { value: 1440, label: '出發前 24 小時' },
];

export function revealLabel(value: number | null): string {
  return OPTIONS.find((option) => option.value === value)?.label ?? `出發前 ${value} 分鐘`;
}
</script>

<script setup lang="ts">
import { t } from '../i18n';

/** When the winning driver may see the passenger's contact. Null: as soon as the order is claimed. */
const model = defineModel<number | null>({ required: true });
</script>

<template>
  <select v-model="model" class="select">
    <option v-for="option in OPTIONS" :key="String(option.value)" :value="option.value">{{ t(option.label) }}</option>
  </select>
</template>
