<script setup lang="ts">
import AppIcon, { type IconName } from './AppIcon.vue';

/** One-line status with an icon on a light blue box (taken, cancelled, yours), after Master Travel's driver app. */
withDefaults(defineProps<{ icon?: IconName; tone?: 'info' | 'error' }>(), { icon: 'info', tone: 'info' });
</script>

<template>
  <div class="inline-status" :class="`inline-status--${tone}`" role="status">
    <AppIcon :name="icon" />
    <span><slot /></span>
  </div>
</template>

<style scoped>
.inline-status {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
  border-radius: var(--radius-input);
  background: var(--color-tint);
  font-weight: 600;
}
.inline-status > svg {
  color: var(--color-primary);
  margin-top: 1px;
}
.inline-status--error {
  background: var(--color-error-tint);
  color: var(--color-error);
}
.inline-status--error > svg {
  color: var(--color-error);
}
</style>
