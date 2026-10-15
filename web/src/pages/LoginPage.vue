<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import BrandPanel from '../components/BrandPanel.vue';
import PageBack from '../components/PageBack.vue';
import SignInForm from '../components/SignInForm.vue';
import { t } from '../i18n';

/** What a driver gets, in the words they would use; the same three points as the home page. */
const POINTS = ['不用換群', '不用下載', '免費出單接單'];

const route = useRoute();
const router = useRouter();

function done() {
  const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/app';
  void router.replace(next);
}
</script>

<template>
  <div class="login">
    <!-- The same panel as the home page, after the layout of Master Travel's sign-in page. -->
    <BrandPanel>
      <template #left><PageBack fallback="/" history icon-only /></template>
    </BrandPanel>

    <main class="login__body">
      <!-- The brand mark in the panel names us; the heading says what this page is for. -->
      <h1>{{ t('用手機號碼登入') }}</h1>
      <p class="login__lead">{{ t('有單就派，有空就接') }}</p>
      <p class="login__points">{{ POINTS.map((point) => t(point)).join(' · ') }}</p>

      <SignInForm @signed-in="done" />

      <footer class="login__footer">
        <p>
          {{ t('登入即表示你同意') }}<RouterLink to="/legal/terms">{{ t('服務條款') }}</RouterLink>{{ t('和') }}<RouterLink to="/legal/privacy">{{ t('私隱政策') }}</RouterLink>
        </p>
        <p>{{ t('登入遇到問題？') }}<RouterLink to="/support">{{ t('聯絡客服') }}</RouterLink></p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(var(--space-xl) + var(--safe-bottom));
}
.login__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-xl) 0;
  animation: login-rise 0.45s ease-out both;
}
@keyframes login-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .login__body {
    animation: none;
  }
}
.login__body h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 0.02em;
}
.login__lead {
  margin: -6px 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-body);
}
.login__points {
  margin: -8px 0 var(--space-lg);
  color: var(--color-teal);
  font-size: var(--font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.login__footer {
  margin-top: var(--space-md);
  color: var(--color-text-muted);
  font-size: var(--font-caption);
  text-align: center;
}
.login__footer p {
  margin: var(--space-xs) 0;
}
</style>
