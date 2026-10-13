<script setup lang="ts">
/** A card's title (18px, medium, as on Master Travel's passenger pages) with an optional line under it and something on the right. */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="section-heading">
    <div class="section-heading__text">
      <h2>{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.section-heading {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}
.section-heading__text {
  flex: 1;
  min-width: 0;
}
.section-heading h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.4;
}
.section-heading p {
  margin: var(--space-xs) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
  line-height: 1.45;
}
</style>
