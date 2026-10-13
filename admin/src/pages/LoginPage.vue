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
    <div class="login-page__orb login-page__orb--one"></div>
    <div class="login-page__orb login-page__orb--two"></div>
    <form class="login-page__form" @submit.prevent="submit">
      <div class="login-page__brand">
        <strong>MasterDriver</strong>
        <span>跨境師傅幫｜平台後台</span>
      </div>
      <h1>歡迎回來</h1>
      <p>登入以管理用戶、訂單與平台設定。</p>
      <input v-model="username" aria-label="帳號" placeholder="帳號" autocomplete="username" required />
      <input
        v-model="password"
        aria-label="密碼"
        type="password"
        placeholder="密碼"
        autocomplete="current-password"
        required
      />
      <button type="submit" :disabled="busy">{{ busy ? '登入中…' : '登入' }}</button>
      <small v-if="error" role="alert">{{ error }}</small>
    </form>
  </div>
</template>

<style scoped>
/* Animated dark-blue sign-in, as in the Master Travel admin. */
.login-page {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 32px 20px;
  overflow: hidden;
  isolation: isolate;
  background: linear-gradient(125deg, #102d4f, #1b426c, #102d4f, #285983);
  background-size: 300% 300%;
  animation: login-background-drift 18s ease-in-out infinite;
}

.login-page::before,
.login-page::after {
  content: '';
  position: absolute;
  z-index: -1;
  border-radius: 50%;
  pointer-events: none;
}

.login-page::before {
  top: -26%;
  left: -8%;
  width: min(720px, 90vw);
  height: min(720px, 90vw);
  background: radial-gradient(circle at 60% 58%, rgba(111, 173, 239, 0.46), rgba(111, 173, 239, 0) 68%);
  animation: login-glow-one 14s ease-in-out infinite alternate;
}

.login-page::after {
  right: -12%;
  bottom: -32%;
  width: min(620px, 80vw);
  height: min(620px, 80vw);
  background: radial-gradient(circle, rgba(72, 145, 220, 0.4), rgba(72, 145, 220, 0) 70%);
  animation: login-glow-two 17s ease-in-out infinite alternate;
}

@keyframes login-background-drift {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

@keyframes login-glow-one {
  0% {
    transform: translate3d(-2%, -1%, 0) scale(1);
  }
  100% {
    transform: translate3d(8%, 6%, 0) scale(1.12);
  }
}

@keyframes login-glow-two {
  0% {
    transform: translate3d(4%, 3%, 0) scale(1.02);
  }
  100% {
    transform: translate3d(-9%, -7%, 0) scale(1.14);
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-page,
  .login-page::before,
  .login-page::after {
    animation: none;
  }
}

.login-page__orb {
  position: absolute;
  border-radius: 50%;
  opacity: 0.25;
  filter: blur(1px);
  pointer-events: none;
}

.login-page__orb--one {
  top: 5%;
  left: 7%;
  width: 220px;
  height: 220px;
  background: #75b8ff;
}

.login-page__orb--two {
  right: 15%;
  bottom: -7%;
  width: 180px;
  height: 180px;
  background: #82cbff;
}

.login-page__form {
  position: relative;
  z-index: 1;
  width: min(520px, 100%);
  padding: clamp(38px, 7vw, 72px) clamp(28px, 7vw, 64px) 54px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 30px;
  background: rgba(18, 45, 79, 0.72);
  box-shadow: 0 30px 80px rgba(5, 25, 51, 0.34);
  backdrop-filter: blur(18px);
}

.login-page__brand {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 56px;
  color: #fff;
}

.login-page__brand strong {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.login-page__brand span {
  color: rgba(255, 255, 255, 0.72);
  font-size: var(--font-caption);
}

.login-page h1 {
  margin: 48px 0 0;
  color: #fff;
  font-size: clamp(28px, 4vw, 36px);
  line-height: 1.2;
  letter-spacing: -0.03em;
}

.login-page p {
  margin: 14px 0 26px;
  color: rgba(255, 255, 255, 0.72);
  font-size: clamp(14px, 2vw, 16px);
  line-height: 1.5;
}

.login-page input {
  display: block;
  width: 100%;
  min-height: 56px;
  margin: 12px 0;
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 13px;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  font-size: 14px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.login-page input::placeholder {
  color: rgba(255, 255, 255, 0.7);
  opacity: 1;
}

.login-page input:focus {
  outline: none;
  border-color: #79b8ff;
  background: rgba(255, 255, 255, 0.16);
  box-shadow: 0 0 0 4px rgba(121, 184, 255, 0.14);
}

.login-page button[type='submit'] {
  width: 100%;
  min-height: 50px;
  margin-top: 16px;
  border: 0;
  border-radius: 13px;
  color: #fff;
  background: linear-gradient(135deg, #1769e0, #438fe9);
  box-shadow: 0 8px 18px rgba(23, 105, 224, 0.24);
  font-size: 15px;
  font-weight: 800;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.login-page button[type='submit']:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 14px 26px rgba(23, 105, 224, 0.3);
}

.login-page button[type='submit']:disabled {
  opacity: 0.7;
  cursor: wait;
}

.login-page small {
  display: block;
  margin-top: 15px;
  color: #ff9b9b;
  font-size: 14px;
  line-height: 1.5;
}

@media (max-width: 560px) {
  .login-page {
    padding: 18px 14px;
  }

  .login-page__form {
    padding: 34px 24px 38px;
    border-radius: 24px;
  }

  .login-page h1 {
    margin-top: 42px;
  }
}
</style>
