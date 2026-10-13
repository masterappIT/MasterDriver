<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import SignInForm from '../components/SignInForm.vue';
import { t } from '../i18n';

const route = useRoute();
const router = useRouter();

function done() {
  const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/app';
  void router.replace(next);
}
</script>

<template>
  <div class="page login-page">
    <h1>MasterDriver 跨境師傅幫</h1>
    <p class="muted">{{ t('有單就派，有空就接') }}</p>
    <div class="card">
      <SignInForm @signed-in="done" />
    </div>
    <p class="hint login-page__support">{{ t('登入遇到問題？') }}<RouterLink to="/support">{{ t('聯絡客服') }}</RouterLink></p>
  </div>
</template>

<style scoped>
.login-page {
  padding-top: 15vh;
}
.login-page__support {
  text-align: center;
}
.login-page h1 {
  margin-bottom: var(--space-xs);
}
</style>
