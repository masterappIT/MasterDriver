<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BrandMark from './BrandMark.vue';

/**
 * The curved harbour-blue panel with the white mark at the top of the public pages
 * (home and sign-in), so moving between them reads as one screen. Slots sit in its corners.
 *
 * Safari (iOS 26) paints its whole top bar (status bar and address bar) in the colour of a fixed bar
 * at the top of the page, and in the page's light background otherwise; a bar behind the page is not
 * seen. It takes the colour when the bar appears and keeps it while the bar stays, even if the bar
 * then turns transparent (measured in the simulator). So a thin fixed bar appears in the panel's
 * colour, turns transparent once Safari has taken it, and stays while any of the panel is on screen:
 * Safari's top bar is blue the whole way the panel scrolls under it, and the bar itself never shows
 * as a strip over the page. It goes once the panel is gone, and comes back with it.
 */
const panel = ref<HTMLElement | null>(null);
const shown = ref(true);
const painted = ref(true);
let frame = 0;
let fade: ReturnType<typeof setTimeout> | undefined;

/** Long enough for Safari to take the colour (800 ms measured to work). */
const TAKE_COLOUR_MS = 800;

function show(value: boolean) {
  if (value === shown.value) return;
  shown.value = value;
  clearTimeout(fade);
  if (!value) return;
  painted.value = true;
  fade = setTimeout(() => (painted.value = false), TAKE_COLOUR_MS);
}
function measure() {
  frame = 0;
  show((panel.value?.getBoundingClientRect().bottom ?? 0) > 0);
}
function onScroll() {
  if (!frame) frame = requestAnimationFrame(measure);
}
onMounted(() => {
  fade = setTimeout(() => (painted.value = false), TAKE_COLOUR_MS);
  measure();
  window.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
  if (frame) cancelAnimationFrame(frame);
  clearTimeout(fade);
});
</script>

<template>
  <div v-if="shown" class="brand-panel__status" :class="{ 'brand-panel__status--clear': !painted }" aria-hidden="true"></div>
  <div class="brand-panel__wrap">
    <!-- Pulled down past the top, the page shows the panel's colour above it, not a light gap. -->
    <div class="brand-panel__above" aria-hidden="true"></div>
    <header ref="panel" class="brand-panel">
      <div class="brand-panel__corners">
        <div><slot name="left" /></div>
        <div><slot name="right" /></div>
      </div>
      <BrandMark light :size="30" />
    </header>
  </div>
</template>

<style scoped>
.brand-panel,
.brand-panel__above,
.brand-panel__status {
  --brand-panel-top: #3b7de6;
}
.brand-panel__status {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  height: 10px;
  background: var(--brand-panel-top);
  pointer-events: none;
}
.brand-panel__status--clear {
  background: transparent;
}
.brand-panel__wrap {
  position: relative;
}
.brand-panel__above {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 100vh;
  background: var(--brand-panel-top);
}
.brand-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  /* Short, so with Safari's top bar painted blue above it the blue does not run too far down. */
  height: 136px;
  padding: var(--space-md) var(--space-xl) 36px;
  overflow: hidden;
  /* The top edge is one colour, the status bar's, and runs into the diagonal below it. */
  background:
    linear-gradient(180deg, var(--brand-panel-top) 0, var(--brand-panel-top) 12px, rgba(59, 125, 230, 0) 72px),
    linear-gradient(135deg, var(--brand-panel-top) 0%, #2f8fd6 50%, #23ada6 100%);
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
  /* Wholly inside the panel: cut off at its top, the disc's flat edge would show under the blue status bar. */
  top: 16px;
  right: -70px;
  background: rgba(255, 255, 255, 0.12);
}
.brand-panel::after {
  width: 90px;
  height: 90px;
  top: 24px;
  right: 120px;
  background: rgba(255, 255, 255, 0.08);
}
.brand-panel__corners {
  position: absolute;
  /* Below the 10 px status bar strip, which would cover the buttons' top edge. */
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
