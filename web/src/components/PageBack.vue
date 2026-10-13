<script setup lang="ts">
import { useRouter } from 'vue-router';
import { t } from '../i18n';
import AppIcon from './AppIcon.vue';

/**
 * The top bar of a page one step inside the tool: a clear 返回 on the left, the page's title,
 * and room on the right for the page's own action.
 *
 * 返回 goes up, to the page this one belongs under (`fallback`): 訂單詳情 to 訂單, 預約詳情 to 預約,
 * the pages of 我的 to 我的. Where the driver came from does not matter, so the same button always
 * leads to the same place. Pages that are opened from many places and belong under none of them
 * (客服, the terms, a link from a group) set `history` and go back to wherever the driver was,
 * or to `fallback` when the page was opened on its own.
 *
 * `onlyInApp` hides the bar on pages people usually open from a group link. `iconOnly` shows just a
 * round arrow, for a coloured panel such as the sign-in page's.
 */
const props = withDefaults(defineProps<{ title?: string; fallback?: string; history?: boolean; onlyInApp?: boolean; iconOnly?: boolean }>(), {
  title: '',
  fallback: '/app',
  history: false,
  onlyInApp: false,
  iconOnly: false,
});
const router = useRouter();
// Vue Router records the previous in-app page here; it is empty when the page was opened directly.
const previous = typeof window !== 'undefined' ? ((window.history.state as { back?: unknown } | null)?.back ?? null) : null;
const hasPrevious = Boolean(previous);
const pathOf = (address: unknown) => (typeof address === 'string' ? address.split(/[?#]/)[0] : null);

function back() {
  // Stepping back in history is the same move when the page above is the one just left, and keeps its place on screen.
  const goesUp = pathOf(previous) === pathOf(props.fallback);
  if (hasPrevious && (props.history || goesUp)) router.back();
  else void router.replace(props.fallback);
}
</script>

<template>
  <header v-if="!onlyInApp || hasPrevious" class="page-back" :class="{ 'page-back--icon': iconOnly }">
    <button class="page-back__button" type="button" :aria-label="iconOnly ? t('返回') : undefined" @click="back">
      <AppIcon name="back" :size="24" />
      <span v-if="!iconOnly">{{ t('返回') }}</span>
    </button>
    <h1 v-if="title" class="page-back__title">{{ title }}</h1>
    <span v-else></span>
    <div class="page-back__side"><slot /></div>
  </header>
</template>

<style scoped>
.page-back {
  display: grid;
  grid-template-columns: minmax(72px, auto) 1fr minmax(72px, auto);
  align-items: center;
  gap: var(--space-sm);
  min-height: 44px;
  margin: 0 0 var(--space-md);
}
.page-back__button {
  display: inline-flex;
  align-items: center;
  gap: 0;
  justify-self: start;
  min-height: 40px;
  margin-left: calc(var(--space-sm) * -1);
  padding: 0 var(--space-md) 0 var(--space-xs);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-pill);
  background: var(--color-card);
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
/* Just the arrow in a round, translucent white button, over a coloured panel. */
.page-back--icon {
  display: block;
  min-height: 0;
}
.page-back--icon .page-back__button {
  justify-content: center;
  width: 40px;
  height: 40px;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: rgba(255, 255, 255, 0.22);
  color: var(--color-on-primary);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.page-back__title {
  margin: 0;
  font-size: 18px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-back__side {
  display: flex;
  justify-content: flex-end;
}
</style>
