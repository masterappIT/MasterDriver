<script setup lang="ts">
import mark from '../assets/brand/masterapp-mark.svg';

/**
 * The brand: the white cloud M (supplied by the owner, 2026-10-14) on a harbour-blue tile,
 * with the MasterDriver name beside it. `light` drops the tile for a dark or coloured
 * background, where the white mark stands on its own.
 */
withDefaults(defineProps<{ light?: boolean; size?: number; name?: boolean }>(), { light: false, size: 32, name: true });
</script>

<template>
  <span class="brand-mark" :class="{ 'brand-mark--light': light }" :style="{ '--brand-size': `${size}px` }">
    <span class="brand-mark__tile"><img :src="mark" alt="" /></span>
    <span v-if="name" class="brand-mark__name">MasterDriver</span>
  </span>
</template>

<style scoped>
.brand-mark {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--brand-size) * 0.3);
  color: var(--color-text);
}
.brand-mark__tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--brand-size);
  height: var(--brand-size);
  flex-shrink: 0;
  border-radius: calc(var(--brand-size) * 0.28);
  background: linear-gradient(135deg, var(--color-primary), var(--color-teal));
}
/* The mark keeps its own 50 × 38 proportions inside the tile. */
.brand-mark__tile img {
  display: block;
  width: 68%;
  height: auto;
}
.brand-mark__name {
  font-size: calc(var(--brand-size) * 0.5);
  font-weight: 700;
  letter-spacing: 0.01em;
}
.brand-mark--light {
  color: var(--color-on-primary);
}
.brand-mark--light .brand-mark__tile {
  background: none;
  width: auto;
}
.brand-mark--light .brand-mark__tile img {
  width: calc(var(--brand-size) * 1.3);
}
</style>
