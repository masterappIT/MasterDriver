<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import { GUIDE_INDEX, GUIDES, guidePageTitle, guidePath } from '@masterdriver/shared/guides';
import BrandHeader from '../../components/BrandHeader.vue';
import PageBack from '../../components/PageBack.vue';
import GuideLanguage from '../../components/GuideLanguage.vue';
import { t } from '../../i18n';

/**
 * 使用教學 (/guide): every feature's page in reading order, each with what it does for the driver.
 * Public, so it can be sent to a driver before they sign in.
 */
const originalTitle = document.title;
document.title = t(guidePageTitle());
onBeforeUnmount(() => {
  document.title = originalTitle;
});
</script>

<template>
  <div class="page guide-index">
    <!-- From 我的: 返回 goes back there. Opened from a link sent to the driver, there is nothing to go back to. -->
    <PageBack fallback="/app/me" history only-in-app />
    <BrandHeader />
    <div class="guide-index__top">
      <h1>{{ t('使用教學') }}</h1>
      <GuideLanguage />
    </div>
    <p class="guide-index__lead">{{ t(GUIDE_INDEX.description) }}</p>

    <ol class="guide-index__list">
      <li v-for="(guide, index) in GUIDES" :key="guide.slug">
        <RouterLink :to="guidePath(guide.slug)" class="guide-index__item">
          <span class="guide-index__number">{{ index + 1 }}</span>
          <span class="guide-index__words">
            <strong>{{ t(guide.title) }}</strong>
            <span>{{ t(guide.description) }}</span>
          </span>
        </RouterLink>
      </li>
    </ol>

    <RouterLink class="button block large" to="/app">{{ t('打開師傅幫') }}</RouterLink>
    <p class="guide-index__note">{{ t('有問題？') }}<RouterLink to="/support">{{ t('聯絡客服') }}</RouterLink></p>
  </div>
</template>

<style scoped>
.guide-index {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.guide-index__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.guide-index__top h1 {
  margin: 0;
}
.guide-index__lead {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-body-large);
}
.guide-index__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin: 0;
  padding: 0;
}
.guide-index__item {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-card);
  background: var(--color-card);
  color: var(--color-text);
  text-decoration: none;
}
.guide-index__number {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
}
.guide-index__words {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.guide-index__words strong {
  font-size: var(--font-body-large);
}
.guide-index__words span {
  color: var(--color-text-secondary);
}
.guide-index__note {
  margin: 0;
  color: var(--color-text-secondary);
  text-align: center;
}
</style>
