<script setup lang="ts">
import { ORDER_STATUS } from '../format';

defineProps<{ status: string; confirmed?: boolean }>();
</script>

<template>
  <span class="status-badge" :class="`status-badge--${status.toLowerCase()}`">
    {{ ORDER_STATUS[status] ?? status }}<template v-if="confirmed && status === 'ASSIGNED'">・乘客已確認</template>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-block;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  font-size: var(--font-caption);
  color: var(--color-on-primary);
  white-space: nowrap;
}

.status-badge--open {
  background: var(--status-open);
}

.status-badge--assigned {
  background: var(--status-assigned);
}

.status-badge--completed {
  background: var(--status-completed);
}

.status-badge--cancelled {
  background: var(--status-cancelled);
}
</style>
