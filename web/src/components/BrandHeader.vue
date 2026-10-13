<script setup lang="ts">
import { t } from '../i18n';
import BrandMark from './BrandMark.vue';

/** The thin top bar on pages opened from a link: the brand mark and the slogan. */
withDefaults(defineProps<{ subtitle?: string }>(), { subtitle: '有單就派，有空就接' });
</script>

<template>
  <header class="brand-header">
    <RouterLink to="/" class="brand-header__home">
      <BrandMark :size="28" />
    </RouterLink>
    <span>{{ t(subtitle) }}</span>
  </header>
</template>

<style scoped>
.brand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 36px;
  margin-bottom: var(--space-md);
}
.brand-header__home {
  display: flex;
  align-items: center;
  color: var(--color-text);
}
.brand-header > span {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
</style>
