<script setup lang="ts">
/** A small status label coloured by what it asks of the reader: waiting, under way, done or closed. */
defineProps<{ tone: 'waiting' | 'passenger' | 'done' | 'closed'; dot?: boolean }>();
</script>

<template>
  <span class="tone-pill" :class="`tone-pill--${tone}`"><span v-if="dot" class="tone-pill__dot"></span><slot /></span>
</template>

<style scoped>
.tone-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  font-size: var(--font-caption);
  font-weight: 700;
  white-space: nowrap;
}
.tone-pill--waiting {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.tone-pill--passenger {
  background: var(--color-tint);
  color: var(--color-primary-dark);
}
.tone-pill--done {
  background: var(--status-confirmed-tint);
  color: var(--status-confirmed);
}
.tone-pill--closed {
  background: var(--color-divider);
  color: var(--color-text-secondary);
}
.tone-pill__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-error);
}
</style>
