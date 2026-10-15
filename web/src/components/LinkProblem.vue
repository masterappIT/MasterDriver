<script setup lang="ts">
import { t } from '../i18n';
import AppIcon from './AppIcon.vue';
import BrandMark from './BrandMark.vue';

/**
 * A link that did not open: what went wrong, what to do next, a way to try again, and who made the
 * page. On a passenger's page the driver is the one to ask, so `next` names them; our name stays
 * small at the bottom, as everywhere a passenger looks (README, 紅線 6).
 */
/** `brand`: off where the page already shows our name at the top, as the 搶單 page does. */
withDefaults(defineProps<{ message: string; next: string; brand?: boolean }>(), { brand: true });

/** Templates cannot reach window, so the reload goes through here. */
const reload = () => window.location.reload();
</script>

<template>
  <section class="card link-problem" role="alert">
    <AppIcon name="error" :size="40" />
    <p class="link-problem__message">{{ message }}</p>
    <p class="link-problem__next">{{ t(next) }}</p>
    <button class="button secondary" type="button" @click="reload">{{ t('重新載入') }}</button>
    <RouterLink v-if="brand" to="/" class="link-problem__brand">
      <BrandMark :name="false" :size="20" />
      <span>{{ t('由 MasterDriver 跨境師傅幫提供') }}</span>
    </RouterLink>
  </section>
</template>

<style scoped>
.link-problem {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-lg);
  color: var(--color-text-secondary);
  text-align: center;
}
.link-problem > svg {
  color: var(--color-error);
}
.link-problem p {
  margin: 0;
}
.link-problem__message {
  color: var(--color-text);
  font-size: var(--font-body-large);
  font-weight: 700;
}
.link-problem__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}
</style>
