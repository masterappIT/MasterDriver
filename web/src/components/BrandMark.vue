<script setup lang="ts">
import mark from '../assets/brand/masterapp-mark.svg';
import { t } from '../i18n';

/**
 * The brand: the white cloud M (supplied by the owner, 2026-10-14) on a harbour-blue tile, with
 * the name beside it. 跨境師傅幫 leads and MasterDriver sits under it, smaller (docs/DESIGN.md,
 * 品牌區隔: the Chinese name is what sets us apart from Master Travel's 「Master App Driver」).
 * `light` drops the tile for a dark or coloured background, where the white mark stands on its own.
 */
withDefaults(defineProps<{ light?: boolean; size?: number; name?: boolean }>(), { light: false, size: 32, name: true });
</script>

<template>
  <span class="brand-mark" :class="{ 'brand-mark--light': light }" :style="{ '--brand-size': `${size}px` }">
    <span class="brand-mark__tile"><img :src="mark" alt="" /></span>
    <span v-if="name" class="brand-mark__name">
      <b>{{ t('跨境師傅幫') }}</b>
      <small>MasterDriver</small>
    </span>
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
/* Two lines as tall as the tile: the Chinese name, then MasterDriver in small spaced letters. */
.brand-mark__name {
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.1;
}
.brand-mark__name b {
  font-size: calc(var(--brand-size) * 0.52);
  font-weight: 800;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.brand-mark__name small {
  margin-top: calc(var(--brand-size) * 0.06);
  color: var(--color-text-secondary);
  font-size: calc(var(--brand-size) * 0.3);
  font-weight: 700;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.brand-mark--light .brand-mark__name small {
  color: inherit;
  opacity: 0.8;
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
