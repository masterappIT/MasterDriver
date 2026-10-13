<script setup lang="ts">
import { t } from '../i18n';

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="bottom-sheet" @click.self="emit('close')">
    <section class="bottom-sheet__panel" role="dialog" aria-modal="true" :aria-label="title">
      <header class="bottom-sheet__header">
        <h2>{{ title }}</h2>
        <button class="bottom-sheet__close" type="button" :aria-label="t('關閉')" @click="emit('close')">×</button>
      </header>
      <slot />
    </section>
  </div>
</template>

<style scoped>
.bottom-sheet {
  position: fixed;
  inset: 0;
  background: rgba(23, 35, 61, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 30;
}
.bottom-sheet__panel {
  width: 100%;
  max-width: var(--max-width);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  padding: var(--space-lg) var(--space-lg) calc(var(--space-lg) + var(--safe-bottom));
}
.bottom-sheet__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.bottom-sheet__header h2 {
  margin: 0;
}
.bottom-sheet__close {
  border: none;
  background: none;
  font-size: 28px;
  line-height: 1;
  min-width: 44px;
  min-height: 44px;
  color: var(--color-text-secondary);
  cursor: pointer;
}
</style>
