<script setup lang="ts">
import { COUNTRY_CODES, type CountryCode } from '@masterdriver/shared/phone';
import { t } from '../i18n';

/**
 * A passenger's phone: the country code as a small pill, then the number. Hong Kong and Macau
 * take 8 digits, the mainland 11; the form checks the number with isValidPassengerPhone.
 */
const country = defineModel<CountryCode>('country', { required: true });
const phone = defineModel<string>('phone', { required: true });
defineProps<{ id?: string }>();
</script>

<template>
  <div class="phone-field">
    <select v-model="country" class="phone-field__country" :aria-label="t('區號')">
      <option v-for="code in COUNTRY_CODES" :key="code" :value="code">{{ code }}</option>
    </select>
    <input
      :id="id"
      v-model="phone"
      class="line-input"
      type="tel"
      inputmode="tel"
      autocomplete="off"
      maxlength="20"
      :placeholder="country === '+86' ? t('11 位手機號碼') : t('8 位數字')"
      required
    />
  </div>
</template>

<style scoped>
.phone-field {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.phone-field__country {
  flex-shrink: 0;
  min-height: 34px;
  padding: 0 var(--space-sm);
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font: inherit;
  font-weight: 700;
}
.phone-field .line-input {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
