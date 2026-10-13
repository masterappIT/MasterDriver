<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
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
const codeInput = ref<HTMLInputElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

/** The six digit slots of the code, filled as the driver types into the one real input underneath. */
const slots = computed(() => Array.from({ length: 6 }, (_, index) => code.value[index] ?? ''));

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
    setTimeout(() => codeInput.value?.focus(), 0);
  } catch (e) {
    error.value = errorText(e);
    const retry = (e as { detail?: { retryAfterSeconds?: number } }).detail?.retryAfterSeconds;
    if (retry) countdown(retry);
  } finally {
    busy.value = false;
  }
}

async function verify() {
  // The sixth digit and a tap on 登入 can arrive together; send the code once.
  if (busy.value || code.value.length !== 6) return;
  error.value = '';
  busy.value = true;
  try {
    const result = await api<{ token: string }>('POST', '/auth/otp/verify', { countryCode: countryCode.value, phone: phone.value, code: code.value });
    codeInput.value?.blur();
    rememberToken(result.token);
    await loadSession();
    emit('signedIn');
  } catch (e) {
    error.value = errorText(e);
    // A wrong code: empty the boxes and keep the keyboard up for the next try.
    code.value = '';
    setTimeout(() => codeInput.value?.focus(), 0);
  } finally {
    busy.value = false;
  }
}

/**
 * Only digits go into the code, so pasting "驗證碼 123456" still works. The sixth digit signs in
 * at once (typed, pasted, or filled in by the phone from the SMS), so the keyboard never has to
 * be closed to reach 登入.
 */
function onCode(event: Event) {
  code.value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
  if (code.value.length === 6) void verify();
}

/** Back to step one to fix the number; the countdown keeps running, as the server's limit does. */
function changeNumber() {
  sent.value = false;
  code.value = '';
  error.value = '';
}

onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <form class="sign-in" @submit.prevent="sent ? verify() : requestCode()">
    <div v-if="error" class="notice error sign-in__error" role="alert">{{ error }}</div>

    <template v-if="!sent">
      <p class="sign-in__ask">{{ t('輸入手機號碼') }}</p>
      <!-- No box: the code as a small pill, the number large on a single line. -->
      <div class="sign-in__phone">
        <select v-model="countryCode" class="sign-in__country" :aria-label="t('國碼')">
          <option value="+852">+852</option>
          <option value="+86">+86</option>
          <option value="+853">+853</option>
        </select>
        <input
          v-model="phone"
          class="sign-in__number"
          type="tel"
          inputmode="numeric"
          autocomplete="tel-national"
          :placeholder="t('手機號碼')"
          :aria-label="t('手機號碼')"
          required
        />
      </div>
      <button class="button block sign-in__submit" type="submit" :disabled="busy || wait > 0">
        {{ wait > 0 ? t(`${wait} 秒後可重新發送`) : busy ? t('發送中…') : t('取得驗證碼') }}
      </button>
      <p class="sign-in__note">{{ t('驗證一次手機，之後在這部手機都會記住你。') }}</p>
    </template>

    <template v-else>
      <p class="sign-in__ask">
        {{ t('驗證碼已發送到') }} <strong>{{ countryCode }} {{ phone }}</strong>
      </p>
      <!-- Six slots drawn under one real input, which keeps paste and the phone's one-time-code autofill. -->
      <div class="sign-in__slots">
        <input
          ref="codeInput"
          :value="code"
          class="sign-in__code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          :aria-label="t('6 位驗證碼')"
          required
          @input="onCode"
        />
        <span v-for="(digit, index) in slots" :key="index" class="sign-in__slot" :class="{ filled: digit, next: index === code.length }" aria-hidden="true">{{ digit }}</span>
      </div>
      <button class="button block sign-in__submit" type="submit" :disabled="busy || code.length !== 6">{{ busy ? t('登入中…') : t('登入') }}</button>
      <p class="sign-in__note">
        <span v-if="wait > 0">{{ t(`${wait} 秒後可重新發送驗證碼`) }}</span>
        <button v-else class="sign-in__link" type="button" :disabled="busy" @click="requestCode">{{ t('沒收到？重新發送驗證碼') }}</button>
        <span class="sign-in__sep" aria-hidden="true"></span>
        <button class="sign-in__link" type="button" @click="changeNumber">{{ t('更改號碼') }}</button>
      </p>
    </template>
  </form>
</template>

<style scoped>
.sign-in {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.sign-in__error {
  margin: 0;
}
.sign-in__ask {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-body);
}
.sign-in__ask strong {
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.sign-in__phone {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-top: calc(var(--space-sm) * -1);
  padding-bottom: var(--space-sm);
  border-bottom: 2px solid var(--color-border);
  transition: border-color 0.2s ease;
}
.sign-in__phone:focus-within {
  border-bottom-color: var(--color-primary);
}
.sign-in__country {
  appearance: none;
  -webkit-appearance: none;
  flex-shrink: 0;
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
}
.sign-in__number {
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.sign-in__number::placeholder {
  color: var(--color-text-muted);
  font-size: 20px;
  font-weight: 400;
  letter-spacing: normal;
}
.sign-in__slots {
  position: relative;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--space-sm);
  margin-top: calc(var(--space-sm) * -1);
}
/* The real input lies over the slots, invisible, so taps, paste and autofill land in it. */
.sign-in__code {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: none;
  font-size: 16px;
  caret-color: transparent;
}
.sign-in__slot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  border-bottom: 2px solid var(--color-border);
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  transition: border-color 0.2s ease;
}
.sign-in__slot.filled {
  border-bottom-color: var(--color-text);
}
.sign-in__code:focus ~ .sign-in__slot.next {
  border-bottom-color: var(--color-primary);
}
.sign-in__submit {
  min-height: 48px;
  border-radius: var(--radius-pill);
  font-size: 16px;
  box-shadow: 0 8px 18px rgba(31, 95, 214, 0.24);
}
.sign-in__submit:disabled {
  box-shadow: none;
}
.sign-in__note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  margin: calc(var(--space-sm) * -1) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  text-align: center;
}
/* A small dot between the two links, drawn rather than typed. */
.sign-in__sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.sign-in__link {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.sign-in__link:disabled {
  opacity: 0.5;
}
</style>
