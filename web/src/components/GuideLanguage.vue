<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { language, setLanguage, t } from '../i18n';

/**
 * 繁體／简体 on the 使用教學 pages, which are read before signing in, so the app's own setting under
 * 我的 is out of reach. A link sent from the admin may carry ?lang=zh-Hans (or zh-Hant): it applies
 * to this visit without changing what the reader chose on this phone.
 */
const route = useRoute();
onMounted(() => {
  const asked = route.query.lang;
  if (asked === 'zh-Hans' || asked === 'zh-Hant') setLanguage(asked, false);
});
</script>

<template>
  <div class="guide-language" role="group" :aria-label="t('介面語言')">
    <button type="button" :class="{ on: language === 'zh-Hant' }" @click="setLanguage('zh-Hant')">繁體</button>
    <button type="button" :class="{ on: language === 'zh-Hans' }" @click="setLanguage('zh-Hans')">简体</button>
  </div>
</template>

<style scoped>
.guide-language {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--color-tint);
}
.guide-language button {
  min-height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--color-primary-dark);
  font: inherit;
  font-size: var(--font-caption);
  font-weight: 600;
  cursor: pointer;
}
.guide-language button.on {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
</style>
