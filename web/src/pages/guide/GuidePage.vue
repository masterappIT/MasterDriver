<script setup lang="ts">
import { computed, onBeforeUnmount, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GUIDES, findGuide, guidePageTitle, guidePath, type GuideSlug } from '@masterdriver/shared/guides';
import GuideLanguage from '../../components/GuideLanguage.vue';
import GuideShot from '../../components/GuideShot.vue';
import PageBack from '../../components/PageBack.vue';
import { GUIDE_CONTENT } from '../../guides/content';
import { t } from '../../i18n';

/**
 * One feature's 使用教學 (/guide/:slug): what it is for and how it helps the driver's business
 * (幫你解決什麼), the steps in the app's own words, 經營小技巧, 常見問題, and a button into the app.
 * Public; the router sends an unknown slug to the 目錄.
 */
const route = useRoute();
const router = useRouter();
const slug = computed(() => String(route.params.slug) as GuideSlug);
const guide = computed(() => findGuide(slug.value));
const content = computed(() => GUIDE_CONTENT[slug.value]);
const next = computed(() => {
  const at = GUIDES.findIndex((one) => one.slug === slug.value);
  return at >= 0 ? (GUIDES[at + 1] ?? null) : null;
});

/** Read from the page its button opens (我的名片頁 → its guide): go back to it rather than stack a second one. */
function toAction(event: MouseEvent, navigate: (event: MouseEvent) => unknown) {
  // Vue Router records the previous in-app page; empty when the guide was opened on its own.
  if ((window.history.state as { back?: unknown } | null)?.back !== content.value.action.to) return navigate(event);
  event.preventDefault();
  router.back();
}

// The browser tab says which guide this is; index.html's own title comes back on leaving.
const originalTitle = document.title;
watchEffect(() => {
  document.title = t(guidePageTitle(slug.value));
});
onBeforeUnmount(() => {
  document.title = originalTitle;
});
</script>

<template>
  <div v-if="guide && content" class="page guide">
    <!-- Opened from the 目錄, from a page of the app or straight from a link: 返回 goes back, or to the 目錄. -->
    <PageBack :title="t('使用教學')" :fallback="guidePath()" history>
      <GuideLanguage />
    </PageBack>

    <header class="guide__head">
      <h1>{{ t(content.headline) }}</h1>
      <p>{{ t(content.lead) }}</p>
    </header>

    <section class="guide__section">
      <h2>{{ t('幫你解決什麼') }}</h2>
      <ul class="guide__helps">
        <li v-for="help in content.helps" :key="help.title">
          <strong>{{ t(help.title) }}</strong>
          <span>{{ t(help.text) }}</span>
        </li>
      </ul>
    </section>

    <section class="guide__section">
      <h2>{{ t('怎樣用') }}</h2>
      <ol class="guide__steps">
        <li v-for="(step, index) in content.steps" :key="step.title" class="guide__step">
          <GuideShot v-if="step.shot" :name="step.shot" />
          <div class="guide__caption">
            <span class="guide__number">{{ index + 1 }}</span>
            <div>
              <strong>{{ t(step.title) }}</strong>
              <p>{{ t(step.text) }}</p>
            </div>
          </div>
        </li>
      </ol>
    </section>

    <section class="guide__section guide__business">
      <h2>{{ t('經營小技巧') }}</h2>
      <ul>
        <li v-for="tip in content.business" :key="tip">{{ t(tip) }}</li>
      </ul>
    </section>

    <section class="guide__section">
      <h2>{{ t('常見問題') }}</h2>
      <dl class="guide__faq">
        <div v-for="item in content.faq" :key="item.q">
          <dt>{{ t(item.q) }}</dt>
          <dd>{{ t(item.a) }}</dd>
        </div>
      </dl>
    </section>

    <RouterLink v-slot="{ href, navigate }" :to="content.action.to" custom>
      <a class="button block large" :href="href" @click="toAction($event, navigate)">{{ t(content.action.label) }}</a>
    </RouterLink>
    <nav class="guide__more">
      <RouterLink v-if="next" :to="guidePath(next.slug)">{{ t(`下一篇：${next.title}`) }}</RouterLink>
      <RouterLink :to="guidePath()">{{ t('所有教學') }}</RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}
.guide__head h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.3;
}
.guide__head p {
  margin: var(--space-sm) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-body-large);
}
.guide__section h2 {
  margin: 0 0 var(--space-md);
  font-size: var(--font-body-large);
}
.guide__helps {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: 0;
  padding: 0;
}
.guide__helps li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-md) var(--space-lg);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-input);
  background: var(--color-card);
}
.guide__helps span {
  color: var(--color-text-secondary);
}
.guide__steps {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  margin: 0;
  padding: 0;
}
.guide__step {
  overflow: hidden;
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-card);
  background: var(--color-card);
}
.guide__caption {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg) var(--space-lg);
}
.guide__caption strong {
  font-size: var(--font-body-large);
}
.guide__caption p {
  margin: 2px 0 0;
  color: var(--color-text-secondary);
}
.guide__number {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
}
.guide__business {
  padding: var(--space-lg);
  border-radius: var(--radius-card);
  background: var(--color-gold-tint);
}
.guide__business h2 {
  color: var(--color-gold-ink);
}
.guide__business ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: 0;
  padding-left: 1.2em;
}
.guide__faq {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin: 0;
}
.guide__faq dt {
  font-weight: 700;
}
.guide__faq dd {
  margin: 2px 0 0;
  color: var(--color-text-secondary);
}
.guide__more {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
  font-weight: 600;
}
</style>
