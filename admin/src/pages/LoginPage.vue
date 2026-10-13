<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, session, type AdminAccount } from '../api';

const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const { admin } = await api<{ admin: AdminAccount }>('POST', '/auth/login', {
      username: username.value,
      password: password.value,
    });
    session.admin = admin;
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    await router.replace(next);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <form class="card login-page__card" @submit.prevent="submit">
      <h1>MasterDriver 跨境師傅幫</h1>
      <p class="muted">平台後台</p>
      <div v-if="error" class="notice error">{{ error }}</div>
      <label class="field">
        帳號
        <input v-model="username" class="input" autocomplete="username" required />
      </label>
      <label class="field">
        密碼
        <input v-model="password" class="input" type="password" autocomplete="current-password" required />
      </label>
      <button class="button" type="submit" :disabled="busy">登入</button>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
}

.login-page__card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.login-page__card h1,
.login-page__card p {
  margin: 0;
}
</style>
