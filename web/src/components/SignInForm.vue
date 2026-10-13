<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { api, errorText, loadSession, rememberToken } from '../api';
import { t } from '../i18n';

const emit = defineEmits<{ signedIn: [] }>();

const countryCode = ref<'+852' | '+86' | '+853'>('+852');
const phone = ref('');
const code = ref('');
const sent = ref(false);
const wait = ref(0);
const busy = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

function countdown(seconds: number) {
  wait.value = seconds;
  clearInterval(timer);
  timer = setInterval(() => {
    wait.value -= 1;
    if (wait.value <= 0) clearInterval(timer);
  }, 1000);
}

async function requestCode() {
  error.value = '';
  busy.value = true;
  try {
    const result = await api<{ resendAfterSeconds: number }>('POST', '/auth/otp/request', { countryCode: countryCode.value, phone: phone.value });
    sent.value = true;
    countdown(result.resendAfterSeconds);
  } catch (e) {
    error.value = errorText(e);
    const retry = (e as { detail?: { retryAfterSeconds?: number } }).detail?.retryAfterSeconds;
    if (retry) countdown(retry);
  } finally {
    busy.value = false;
  }
}

async function verify() {
  error.value = '';
  busy.value = true;
  try {
    const result = await api<{ token: string }>('POST', '/auth/otp/verify', { countryCode: countryCode.value, phone: phone.value, code: code.value });
    rememberToken(result.token);
    await loadSession();
    emit('signedIn');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <form class="sign-in" @submit.prevent="sent ? verify() : requestCode()">
    <p class="muted">{{ t('驗證一次手機，之後在這部手機都會記住你。') }}</p>
    <div v-if="error" class="notice error">{{ error }}</div>
    <div class="sign-in__phone">
      <select v-model="countryCode" class="select sign-in__country" :aria-label="t('國碼')">
        <option value="+852">+852</option>
        <option value="+86">+86</option>
        <option value="+853">+853</option>
      </select>
      <input v-model="phone" class="input" type="tel" inputmode="numeric" autocomplete="tel-national" :placeholder="t('手機號碼')" required />
    </div>
    <template v-if="sent">
      <input v-model="code" class="input sign-in__code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\d{6}" :placeholder="t('6 位驗證碼')" required />
      <button class="button block large" type="submit" :disabled="busy || code.length !== 6">{{ t('登入') }}</button>
      <button class="button secondary block" type="button" :disabled="busy || wait > 0" @click="requestCode">
        {{ wait > 0 ? t(`${wait} 秒後可重新發送`) : t('重新發送驗證碼') }}
      </button>
    </template>
    <button v-else class="button block large" type="submit" :disabled="busy || wait > 0">
      {{ wait > 0 ? t(`${wait} 秒後可重新發送`) : t('取得驗證碼') }}
    </button>
  </form>
</template>

<style scoped>
.sign-in {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.sign-in__phone {
  display: flex;
  gap: var(--space-sm);
}
.sign-in__country {
  width: 96px;
  flex-shrink: 0;
}
.sign-in__code {
  letter-spacing: 6px;
  text-align: center;
}
</style>
