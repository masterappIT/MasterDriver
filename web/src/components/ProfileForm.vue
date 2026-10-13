<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api, errorText, session, type Profile } from '../api';
import { t } from '../i18n';

const emit = defineEmits<{ saved: [] }>();
const current = session.profile;
const form = reactive({
  name: current?.name ?? '',
  hkPlate: current?.hkPlate ?? '',
  macauPlate: current?.macauPlate ?? '',
  mainlandPlate: current?.mainlandPlate ?? '',
  vehicleType: current?.vehicleType ?? '',
  seats: current?.seats ? String(current.seats) : '',
  color: current?.color ?? '',
});
const busy = ref(false);
const error = ref('');

async function save() {
  error.value = '';
  busy.value = true;
  try {
    session.profile = await api<Profile>('PUT', '/me/profile', { ...form, seats: form.seats ? Number(form.seats) : undefined });
    emit('saved');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form @submit.prevent="save">
    <p class="muted">{{ t('只需填一次。搶到單後，派單者和乘客會看到你的姓名與車牌。') }}</p>
    <div v-if="error" class="notice error">{{ error }}</div>
    <label class="field">{{ t('姓名或稱呼') }}<input v-model="form.name" class="input" maxlength="30" :placeholder="t('例如：李師傅')" required /></label>
    <label class="field">{{ t('香港車牌') }}<input v-model="form.hkPlate" class="input" maxlength="12" /></label>
    <label class="field">{{ t('內地車牌') }}<input v-model="form.mainlandPlate" class="input" maxlength="12" :placeholder="t('例如：粵Z1234港')" /></label>
    <label class="field">{{ t('澳門車牌（選填）') }}<input v-model="form.macauPlate" class="input" maxlength="12" /></label>
    <div class="row">
      <label class="field profile-form__half">{{ t('車型') }}<input v-model="form.vehicleType" class="input" maxlength="30" :placeholder="t('例如：埃爾法')" /></label>
      <label class="field profile-form__half">{{ t('座位') }}<input v-model="form.seats" class="input" type="number" min="1" max="60" inputmode="numeric" /></label>
    </div>
    <label class="field">{{ t('車色') }}<input v-model="form.color" class="input" maxlength="20" /></label>
    <button class="button block large" type="submit" :disabled="busy">{{ t('儲存') }}</button>
  </form>
</template>

<style scoped>
.profile-form__half {
  flex: 1;
  min-width: 0;
}
</style>
