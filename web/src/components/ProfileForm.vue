<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  OWNERSHIP_NAMES,
  PLATE_FIELD_NAMES,
  PLATE_TYPE_NAMES,
  VEHICLE_OWNERSHIPS,
  composeMainlandPlate,
  formatHongKongPlateInput,
  formatMacauPlateInput,
  inferVehiclePlates,
  mainlandPlateInput,
  normalizeVehiclePlates,
  plateFieldsFor,
  plateTypesFor,
  vehiclePlateError,
  type PlateField,
  type VehicleOwnership,
  type VehiclePlateError,
} from '@masterdriver/shared/vehicle-plate';
import { api, errorText, session, type Profile } from '../api';
import { t } from '../i18n';

const PLATE_ERRORS: Record<VehiclePlateError, string> = {
  PLATE_TYPE_NOT_ALLOWED: '中國內地的車只有兩地牌',
  PLATE_REQUIRED: '請完成所有車牌資料',
  HK_PLATE_INVALID: '香港車牌只可包含英文字母、數字及空格，不含空格最多 8 個字元',
  MACAU_PLATE_INVALID: '澳門車牌格式必須為 AA-00-00',
  MAINLAND_PLATE_INVALID: '內地車牌格式不正確，請檢查',
};

const emit = defineEmits<{ saved: [] }>();
const current = session.profile;
// A profile from before the ownership and plate type were asked opens on what its plates fit.
const start = {
  ...inferVehiclePlates(current ?? {}),
  ...(current?.vehicleOwnership && current.plateType ? { vehicleOwnership: current.vehicleOwnership, plateType: current.plateType } : {}),
};
const form = reactive({
  name: current?.name ?? '',
  vehicleOwnership: start.vehicleOwnership,
  plateType: start.plateType,
  hkPlate: current?.hkPlate ?? '',
  macauPlate: formatMacauPlateInput(current?.macauPlate ?? ''),
  // Only the part between the fixed 粵Z· and 港／澳 is typed.
  mainlandPlate: mainlandPlateInput(current?.mainlandPlate ?? '', start.vehicleOwnership),
  vehicleType: current?.vehicleType ?? '',
  seats: current?.seats ? String(current.seats) : '',
  color: current?.color ?? '',
  hidePlates: current?.hidePlates ?? false,
});

/**
 * 港澳號碼 and 內地號碼, each typed without its code. A side not filled in yet starts with the
 * number the driver signs in with, when that number is of that side; the other is theirs to add.
 */
const signIn = session.user;
const stored = (value: string | null | undefined) => {
  const [code, number] = (value ?? '').split(' ');
  return { code: code ?? '', number: number ?? '' };
};
const hkMacau = stored(current?.hkMacauPhone ?? (signIn && signIn.countryCode !== '+86' ? `${signIn.countryCode} ${signIn.phone}` : null));
const mainland = stored(current?.mainlandPhone ?? (signIn?.countryCode === '+86' ? `+86 ${signIn.phone}` : null));
const phones = reactive({
  hkMacauCode: hkMacau.code === '+853' ? '+853' : '+852',
  hkMacau: hkMacau.number,
  mainland: mainland.number,
});
const busy = ref(false);
const error = ref('');

const plateTypes = computed(() => plateTypesFor(form.vehicleOwnership));
const plateFields = computed(() => plateFieldsFor(form.vehicleOwnership, form.plateType));
const mainlandPrefix = computed(() => (form.vehicleOwnership === 'MAINLAND' ? '粵' : '粵Z·'));
const mainlandSuffix = computed(() => ({ HK: '港', MACAU: '澳', MAINLAND: '' })[form.vehicleOwnership]);

/** The plates of one place do not carry over to a car registered in another. */
function chooseOwnership(ownership: VehicleOwnership) {
  if (ownership === form.vehicleOwnership) return;
  Object.assign(form, { vehicleOwnership: ownership, hkPlate: '', macauPlate: '', mainlandPlate: '' });
  if (!plateTypesFor(ownership).includes(form.plateType)) form.plateType = 'DUAL';
}

function typePlate(field: PlateField, value: string) {
  form[field] =
    field === 'hkPlate'
      ? formatHongKongPlateInput(value)
      : field === 'macauPlate'
        ? formatMacauPlateInput(value)
        : mainlandPlateInput(value, form.vehicleOwnership);
}

async function save() {
  error.value = '';
  const plates = normalizeVehiclePlates(form);
  const plateError = vehiclePlateError({ ...form, ...plates });
  if (plateError) {
    error.value = t(PLATE_ERRORS[plateError]);
    return;
  }
  busy.value = true;
  try {
    session.profile = await api<Profile>('PUT', '/me/profile', {
      ...form,
      ...plates,
      mainlandPlate: composeMainlandPlate(form.mainlandPlate, form.vehicleOwnership),
      seats: form.seats ? Number(form.seats) : undefined,
      hkMacauPhone: phones.hkMacau.trim() ? `${phones.hkMacauCode}${phones.hkMacau.trim()}` : '',
      mainlandPhone: phones.mainland.trim() ? `+86${phones.mainland.trim()}` : '',
    });
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
    <p class="muted">{{ t('只需填一次。搶到單後，出單者和乘客會看到你的姓名與車牌。') }}</p>
    <label class="field">{{ t('姓名或稱呼') }}<input v-model="form.name" class="input" maxlength="30" :placeholder="t('例如：李師傅')" required /></label>

    <div class="field">
      {{ t('車輛歸屬地') }}
      <div class="chips">
        <button
          v-for="ownership in VEHICLE_OWNERSHIPS"
          :key="ownership"
          class="chip profile-form__choice"
          :class="{ 'profile-form__choice--on': form.vehicleOwnership === ownership }"
          type="button"
          :aria-pressed="form.vehicleOwnership === ownership"
          @click="chooseOwnership(ownership)"
        >
          {{ t(OWNERSHIP_NAMES[ownership]) }}
        </button>
      </div>
    </div>
    <div class="field">
      {{ t('車牌類型') }}
      <div class="chips">
        <button
          v-for="plateType in plateTypes"
          :key="plateType"
          class="chip profile-form__choice"
          :class="{ 'profile-form__choice--on': form.plateType === plateType }"
          type="button"
          :aria-pressed="form.plateType === plateType"
          @click="form.plateType = plateType"
        >
          {{ t(PLATE_TYPE_NAMES[plateType]) }}
        </button>
      </div>
    </div>

    <label v-for="plate in plateFields" :key="plate.field" class="field">
      {{ t(PLATE_FIELD_NAMES[plate.field]) }}<template v-if="!plate.required">{{ t('（選填）') }}</template>
      <span class="profile-form__plate">
        <span v-if="plate.field === 'mainlandPlate'" class="profile-form__fixed">{{ t(mainlandPrefix) }}</span>
        <input
          :value="form[plate.field]"
          class="input"
          maxlength="12"
          autocapitalize="characters"
          :placeholder="plate.field === 'macauPlate' ? 'AA-00-00' : t(`請輸入${PLATE_FIELD_NAMES[plate.field]}號碼`)"
          :required="plate.required"
          @input="typePlate(plate.field, ($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = form[plate.field]"
        />
        <span v-if="plate.field === 'mainlandPlate' && mainlandSuffix" class="profile-form__fixed">{{ t(mainlandSuffix) }}</span>
      </span>
    </label>

    <label class="field">{{ t('車型') }}<input v-model="form.vehicleType" class="input" maxlength="30" :placeholder="t('例如：埃爾法')" required /></label>
    <div class="row">
      <label class="field profile-form__half">{{ t('座位') }}<input v-model="form.seats" class="input" type="number" min="1" max="60" inputmode="numeric" :placeholder="t('例如：7')" /></label>
      <label class="field profile-form__half">{{ t('車色') }}<input v-model="form.color" class="input" maxlength="20" :placeholder="t('例如：白色')" /></label>
    </div>
    <label class="field">
      {{ t('港澳號碼（選填）') }}
      <span class="profile-form__plate">
        <select v-model="phones.hkMacauCode" class="input profile-form__code" :aria-label="t('港澳號碼區號')">
          <option value="+852">+852</option>
          <option value="+853">+853</option>
        </select>
        <input v-model="phones.hkMacau" class="input" type="tel" inputmode="numeric" maxlength="11" :placeholder="t('8 位手機號碼')" />
      </span>
    </label>
    <label class="field">
      {{ t('內地號碼（選填）') }}
      <span class="profile-form__plate">
        <span class="profile-form__fixed">+86</span>
        <input v-model="phones.mainland" class="input" type="tel" inputmode="numeric" maxlength="13" :placeholder="t('11 位手機號碼')" />
      </span>
    </label>
    <p class="hint">{{ t('過關後換號碼也找得到你。接了單後，出單者和乘客看得到這兩個號碼；號碼不會發驗證碼。') }}</p>

    <label class="profile-form__switch">
      <span>
        {{ t('對乘客隱藏車牌') }}
        <small>{{ t('乘客確認頁不顯示你的車牌，並提醒乘客上車前先向你確認。出單者仍然看得到。隨時可以改回。') }}</small>
      </span>
      <input v-model="form.hidePlates" class="switch" type="checkbox" />
    </label>
    <div v-if="error" class="notice error">{{ error }}</div>
    <button class="button block large" type="submit" :disabled="busy">{{ t('儲存') }}</button>
  </form>
</template>

<style scoped>
.profile-form__half {
  flex: 1;
  min-width: 0;
}
.chips {
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}
.profile-form__choice {
  min-height: 36px;
  padding: var(--space-xs) var(--space-lg);
  font-size: var(--font-body);
}
.profile-form__choice--on {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
}
.profile-form__plate {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.profile-form__plate .input {
  flex: 1;
  min-width: 0;
}
.profile-form__plate .profile-form__code {
  flex: 0 0 auto;
  width: auto;
}
.profile-form__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin: var(--space-lg) 0;
  font-weight: 600;
}
.profile-form__switch > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.profile-form__switch small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
.profile-form__fixed {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--color-label);
}
</style>
