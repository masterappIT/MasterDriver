<script setup lang="ts">
import { statusText } from '../format';

defineProps<{ status: string; confirmed?: boolean }>();
</script>

<template>
  <span class="status-badge" :class="[`status-badge--${status.toLowerCase()}`, { 'status-badge--confirmed': confirmed && status === 'ASSIGNED' }]">
    {{ statusText(status, confirmed) }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-block;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  color: var(--color-on-primary);
  font-size: var(--font-caption);
  white-space: nowrap;
}
.status-badge--open { background: var(--status-open); }
.status-badge--assigned { background: var(--status-assigned); }
.status-badge--confirmed { background: var(--status-confirmed); }
.status-badge--completed { background: var(--status-completed); }
.status-badge--cancelled { background: var(--status-cancelled); }
</style>
