<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';

/**
 * A text exactly as it will be pasted into a group, shown as a message bubble. Links in it are
 * coloured, and `linkNote` says under the bubble what the link is, so a new dispatcher sees that
 * the order already has its own link and that it is copied with the text.
 */
const props = defineProps<{ text: string; linkNote?: string }>();

const URL_PATTERN = /(https?:\/\/[^\s]+)/;

/** The text cut into plain parts and links, in order. */
const parts = computed(() =>
  t(props.text)
    .split(URL_PATTERN)
    .filter(Boolean)
    .map((part) => ({ text: part, link: URL_PATTERN.test(part) })),
);
const hasLink = computed(() => parts.value.some((part) => part.link));
</script>

<template>
  <div class="group-text">
    <pre class="group-text__bubble"><template v-for="(part, index) in parts" :key="index"><span v-if="part.link" class="group-text__link">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></pre>
    <p v-if="linkNote && hasLink" class="group-text__note">{{ linkNote }}</p>
  </div>
</template>

<style scoped>
.group-text {
  margin-bottom: var(--space-md);
}
/* As a message in the group. */
.group-text__bubble {
  margin: 0;
  padding: var(--space-md);
  border-radius: 4px 18px 18px 18px;
  background: var(--color-tint);
  font: inherit;
  font-size: var(--font-label);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.group-text__link {
  color: var(--color-primary);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.group-text__note {
  margin: var(--space-xs) var(--space-xs) 0;
  color: var(--color-primary-dark);
  font-size: var(--font-caption);
}
</style>
