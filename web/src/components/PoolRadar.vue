<script setup lang="ts">
/**
 * 接單池's radar: a sweep turning over rings, saying the pool keeps looking for orders.
 * CSS only (one rotating layer), so it stays light inside WeChat; it stands still for
 * people who ask their phone for less motion.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 200 });
</script>

<template>
  <div class="pool-radar" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <span class="pool-radar__ring pool-radar__ring--outer"></span>
    <span class="pool-radar__ring pool-radar__ring--middle"></span>
    <span class="pool-radar__ring pool-radar__ring--inner"></span>
    <span class="pool-radar__sweep"></span>
    <span class="pool-radar__dot"></span>
  </div>
</template>

<style scoped>
.pool-radar {
  position: relative;
  flex-shrink: 0;
  border-radius: 50%;
  background: radial-gradient(circle, var(--color-tint) 0%, rgba(229, 237, 251, 0.3) 70%, transparent 71%);
  overflow: hidden;
}
.pool-radar__ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border: 1.5px solid rgba(31, 95, 214, 0.18);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
.pool-radar__ring--outer {
  width: 96%;
  height: 96%;
}
.pool-radar__ring--middle {
  width: 64%;
  height: 64%;
}
.pool-radar__ring--inner {
  width: 32%;
  height: 32%;
}
/* The sweep: a teal wedge fading behind the line, turning once every 2.4 seconds. */
.pool-radar__sweep {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(14, 159, 154, 0) 0deg, rgba(14, 159, 154, 0) 270deg, rgba(14, 159, 154, 0.35) 355deg, var(--color-teal) 360deg);
  animation: pool-radar-turn 2.4s linear infinite;
  will-change: transform;
}
.pool-radar__dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(31, 95, 214, 0.18);
  transform: translate(-50%, -50%);
}
@keyframes pool-radar-turn {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .pool-radar__sweep {
    animation: none;
  }
}
</style>
