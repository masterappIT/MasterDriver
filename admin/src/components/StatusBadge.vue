<script setup lang="ts">
import { ORDER_STATUS } from '../format';

defineProps<{ status: string; confirmed?: boolean }>();
</script>

<template>
  <span
    class="status-badge"
    :class="[`status-badge--${status.toLowerCase()}`, { 'status-badge--confirmed': confirmed && status === 'ASSIGNED' }]"
  >
    {{ ORDER_STATUS[status] ?? status }}<template v-if="confirmed && status === 'ASSIGNED'">・乘客已確認</template>
  </span>
</template>

<style scoped>
/* Light pill with coloured text, as the Master Travel admin shows trip statuses. */
.status-badge {
  display: inline-block;
  padding: 6px 10px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 750;
  line-height: 1.2;
  letter-spacing: 0;
  vertical-align: middle;
  white-space: nowrap;
}

.status-badge--open {
  color: var(--status-open);
  background: var(--status-open-bg);
}

.status-badge--assigned {
  color: var(--status-assigned);
  background: var(--status-assigned-bg);
}

.status-badge--assigned.status-badge--confirmed {
  color: var(--status-confirmed);
  background: var(--status-confirmed-bg);
}

.status-badge--completed {
  color: var(--status-completed);
  background: var(--status-completed-bg);
}

.status-badge--cancelled {
  color: var(--status-cancelled);
  background: var(--status-cancelled-bg);
}
</style>
