<script setup lang="ts">
import { RouterLink } from 'vue-router';
import AppIcon from './AppIcon.vue';

/**
 * One line in a list such as 我的: what it is, a short line under it, a red count of what is new,
 * and an arrow. Goes to `to` in the app, or opens `href` outside it. Lines replace boxed sections
 * (docs/DESIGN.md「不要像表格」).
 */
defineProps<{ to?: string; href?: string; title: string; detail?: string; count?: number }>();
</script>

<template>
  <RouterLink v-if="to" :to="to" class="menu-row">
    <span class="menu-row__text">
      <strong>{{ title }}</strong>
      <span v-if="detail" class="menu-row__detail">{{ detail }}</span>
    </span>
    <span v-if="count" class="unread-count">{{ count }}</span>
    <AppIcon name="chevron" class="menu-row__arrow" />
  </RouterLink>
  <a v-else :href="href" class="menu-row" target="_blank" rel="noopener">
    <span class="menu-row__text">
      <strong>{{ title }}</strong>
      <span v-if="detail" class="menu-row__detail">{{ detail }}</span>
    </span>
    <AppIcon name="chevron" class="menu-row__arrow" />
  </a>
</template>

<style scoped>
.menu-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 52px;
  padding: var(--space-sm) 0;
  color: var(--color-text);
}
.menu-row + .menu-row {
  border-top: 1px solid var(--color-divider);
}
.menu-row__text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.menu-row__text strong {
  font-weight: 600;
}
.menu-row__detail {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.menu-row__arrow {
  color: var(--color-text-muted);
}
</style>
