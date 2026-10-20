<script setup lang="ts">
/** Hong Kong plates gold, Macau and mainland plates black, as the real plates are. */
defineProps<{ hk?: string | null; macau?: string | null; mainland?: string | null }>();
</script>

<template>
  <span class="plate-tag">
    <span v-if="hk" class="plate-tag__plate plate-tag__plate--hk">{{ hk }}</span>
    <span v-if="macau" class="plate-tag__plate plate-tag__plate--black">{{ macau }}</span>
    <span v-if="mainland" class="plate-tag__plate plate-tag__plate--black">{{ mainland }}</span>
  </span>
</template>

<style scoped>
.plate-tag {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
/* Read like a plate on a car: the rim drawn inside the edge, figures all the same width. */
.plate-tag__plate {
  border-radius: 5px;
  padding: 2px var(--space-sm);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  line-height: 1.35;
  text-align: center;
  white-space: nowrap;
}
.plate-tag__plate--hk {
  background: var(--plate-gold);
  color: #171717;
  box-shadow: inset 0 0 0 1.5px rgba(23, 23, 23, 0.55);
}
.plate-tag__plate--black {
  background: var(--plate-black);
  color: var(--color-on-primary);
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.7), 0 0 0 1px var(--plate-black);
}
</style>
