<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../api';

const form = reactive({ currentPassword: '', newPassword: '', confirm: '' });
const error = ref('');
const message = ref('');

async function submit() {
  error.value = '';
  message.value = '';
  if (form.newPassword !== form.confirm) {
    error.value = '兩次輸入的新密碼不一致';
    return;
  }
  try {
    await api('POST', '/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
    Object.assign(form, { currentPassword: '', newPassword: '', confirm: '' });
    message.value = '密碼已修改，其他裝置上的登入已失效';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="settings-page">
    <h1>修改密碼</h1>
    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice">{{ message }}</div>
    <form class="card password-page" @submit.prevent="submit">
      <label class="field">目前密碼<input v-model="form.currentPassword" class="input" type="password" autocomplete="current-password" required /></label>
      <label class="field">
        新密碼（至少 12 個字元）
        <input v-model="form.newPassword" class="input" type="password" minlength="12" autocomplete="new-password" required />
      </label>
      <label class="field">再輸入一次<input v-model="form.confirm" class="input" type="password" autocomplete="new-password" required /></label>
      <button class="button" type="submit">修改</button>
    </form>
  </div>
</template>

<style scoped>
.password-page {
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
</style>
