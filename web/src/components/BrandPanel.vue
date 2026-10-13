<script setup lang="ts">
import BrandMark from './BrandMark.vue';

/**
 * The curved harbour-blue panel with the white mark at the top of the public pages
 * (home and sign-in), so moving between them reads as one screen. Slots sit in its corners.
 */
</script>

<template>
  <header class="brand-panel">
    <div class="brand-panel__corners">
      <div><slot name="left" /></div>
      <div><slot name="right" /></div>
    </div>
    <BrandMark light :size="30" />
  </header>
</template>

<style scoped>
.brand-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 170px;
  padding: var(--space-lg) var(--space-xl) 52px;
  overflow: hidden;
  background: linear-gradient(135deg, #3b7de6 0%, #2f8fd6 50%, #23ada6 100%);
  /* The sweeping lower edge: a large ellipse cut from the bottom right. */
  border-bottom-right-radius: 100% 70%;
}
/* Two faint discs of light for depth, so the panel is not one flat block. */
.brand-panel::before,
.brand-panel::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.brand-panel::before {
  width: 180px;
  height: 180px;
  top: -70px;
  right: -40px;
  background: rgba(255, 255, 255, 0.12);
}
.brand-panel::after {
  width: 90px;
  height: 90px;
  top: 40px;
  right: 120px;
  background: rgba(255, 255, 255, 0.08);
}
.brand-panel__corners {
  position: absolute;
  top: var(--space-md);
  left: var(--space-lg);
  right: var(--space-lg);
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.brand-panel__corners :deep(.page-back) {
  margin: 0;
}
</style>
