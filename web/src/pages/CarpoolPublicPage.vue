<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatPassengerPhone, isValidPassengerPhone, type CountryCode } from '@masterdriver/shared/phone';
import { api, errorText } from '../api';
import type { CarpoolCar, CarpoolTrip } from '../carpool';
import CarpoolCarCard from '../components/CarpoolCar.vue';
import PhoneField from '../components/PhoneField.vue';
import { money, pickup, shortTime } from '../format';
import { t } from '../i18n';

interface PublicCarpool extends CarpoolTrip {
  code: string;
  autoConfirm: boolean;
  driver: CarpoolCar;
}

/**
 * The link a driver gives passengers for a 拼車: the trip, the seats left, the driver and their
 * car, and a short form to ask for seats. No account; the passenger gets a link of their own.
 */
const route = useRoute();
const router = useRouter();
const code = String(route.params.code);
const carpool = ref<PublicCarpool | null>(null);
const error = ref('');
const formError = ref('');
const busy = ref(false);
const form = reactive({
  passengers: '1',
  luggage: '0',
  pickupPoint: '',
  dropoff: '',
  passengerName: '',
  passengerCountry: '+852' as CountryCode,
  passengerPhone: '',
  passengerWechat: '',
  notes: '',
});

const open = computed(() => carpool.value?.status === 'OPEN' && carpool.value.left > 0);
const closedText = computed(() => {
  const c = carpool.value;
  if (!c) return '';
  if (c.status === 'CANCELLED') return '這趟拼車已取消。';
  if (c.status === 'OPEN' && c.left === 0) return '這趟拼車已滿。可以直接聯絡司機問問有沒有其他車。';
  return '這趟拼車已截止報位。';
});
/** "剩 4 個位，還差 3 位成行" */
const seatsLine = computed(() => {
  const c = carpool.value;
  if (!c) return '';
  if (c.left === 0) return '已滿';
  return c.short > 0 && c.status === 'OPEN' ? `剩 ${c.left} 個位，還差 ${c.short} 位成行` : `剩 ${c.left} 個位`;
});
const total = computed(() => {
  const price = carpool.value?.seatPrice;
  const count = Number(form.passengers);
  return price && count > 0 ? money({ amount: price.amount * count, currency: price.currency }) : '';
});

async function submit() {
  formError.value = '';
  if (!isValidPassengerPhone(form.passengerCountry, form.passengerPhone)) {
    formError.value = t(form.passengerCountry === '+86' ? '電話請填 11 位內地手機號碼' : '電話請填 8 位數字');
    document.getElementById('seat-phone')?.focus();
    return;
  }
  busy.value = true;
  try {
    const sent = await api<{ code: string }>('POST', `/public/carpools/${code}/seats`, {
      passengers: Number(form.passengers),
      luggage: Number(form.luggage),
      pickupPoint: form.pickupPoint,
      dropoff: form.dropoff,
      passengerName: form.passengerName,
      passengerContact: formatPassengerPhone(form.passengerCountry, form.passengerPhone),
      passengerWechat: form.passengerWechat,
      notes: form.notes,
    });
    await router.push(`/s/${sent.code}?sent=1`);
  } catch (e) {
    formError.value = errorText(e);
    // The seats left may have changed while the passenger filled in the form.
    void load();
  } finally {
    busy.value = false;
  }
}

async function load() {
  try {
    carpool.value = await api<PublicCarpool>('GET', `/public/carpools/${code}`);
    if (carpool.value.pickupPoints.length && !carpool.value.pickupPoints.includes(form.pickupPoint)) form.pickupPoint = carpool.value.pickupPoints[0];
    document.title = `${t('拼車')} ${carpool.value.origin} → ${carpool.value.destination}｜MasterDriver ${t('跨境師傅幫')}`;
  } catch (e) {
    error.value = errorText(e);
  }
}

onMounted(load);
</script>

<template>
  <div class="page carpool-public">
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="carpool">
      <h1 class="carpool-public__title">{{ t('拼車') }}</h1>
      <section class="card carpool-public__trip">
        <strong class="carpool-public__time">{{ pickup(carpool.pickupAt) }}</strong>
        <div class="carpool-public__route">{{ t(`${carpool.origin} 至 ${carpool.destination}`) }}</div>
        <p v-if="carpool.pickupPoints.length" class="carpool-public__line">{{ t(`上車點：${carpool.pickupPoints.join('、')}`) }}</p>
        <div class="carpool-public__price">
          <strong>{{ carpool.seatPrice ? t(`每位 ${money(carpool.seatPrice)}`) : t('每位價錢請向司機查詢') }}</strong>
          <span v-if="carpool.luggagePerSeat !== null">{{ t(`每位 ${carpool.luggagePerSeat} 件行李`) }}</span>
        </div>
        <p class="carpool-public__seats">{{ t(seatsLine) }}</p>
        <p v-if="carpool.status === 'OPEN'" class="hint">{{ t(`${shortTime(carpool.closesAt)} 截止報位`) }}</p>
        <p v-if="carpool.notes" class="carpool-public__note">{{ t(carpool.notes) }}</p>
      </section>

      <section class="card">
        <span class="section-label">{{ t('司機') }}</span>
        <CarpoolCarCard :car="carpool.driver" />
      </section>

      <section v-if="carpool.cancelPolicy" class="card">
        <span class="section-label">{{ t('司機的取消規則') }}</span>
        <p class="carpool-public__policy">{{ t(carpool.cancelPolicy) }}</p>
      </section>

      <div v-if="!open" class="notice">{{ t(closedText) }}</div>

      <form v-else class="card carpool-public__form" @submit.prevent="submit">
        <span class="section-label">{{ t('報位') }}</span>
        <p class="hint">
          {{ carpool.autoConfirm ? t('送出就算報位成功。不用註冊，也不用先付款。') : t('送出後等司機確認。不用註冊，也不用先付款。') }}
        </p>
        <div v-if="formError" class="notice error">{{ formError }}</div>
        <div class="carpool-public__pair">
          <label class="line-field">
            <span>{{ t('人數') }}</span>
            <input v-model="form.passengers" class="line-input" type="number" min="1" :max="carpool.left" inputmode="numeric" required />
          </label>
          <label class="line-field">
            <span>{{ t('行李') }}</span>
            <input v-model="form.luggage" class="line-input" type="number" min="0" max="60" inputmode="numeric" />
          </label>
        </div>
        <p v-if="total" class="carpool-public__total">{{ t(`合共 ${total}，直接付給司機`) }}</p>
        <label v-if="carpool.pickupPoints.length" class="line-field">
          <span>{{ t('在哪裡上車') }}</span>
          <select v-model="form.pickupPoint" class="line-input" required>
            <option v-for="point in carpool.pickupPoints" :key="point" :value="point">{{ t(point) }}</option>
          </select>
        </label>
        <label v-else class="line-field">
          <span>{{ t('在哪裡上車') }}</span>
          <input v-model="form.pickupPoint" class="line-input" maxlength="120" :placeholder="t(`例如：${carpool.origin}`)" required />
        </label>
        <label class="line-field">
          <span>{{ t('在哪裡下車（選填）') }}</span>
          <input v-model="form.dropoff" class="line-input" maxlength="120" :placeholder="t(`不填就是 ${carpool.destination}`)" />
        </label>
        <input v-model.trim="form.passengerName" class="line-input carpool-public__gap" maxlength="40" :aria-label="t('稱呼')" :placeholder="t('怎樣稱呼你，例如：王小姐')" required />
        <div class="line-field">
          <label for="seat-phone">{{ t('你的電話，司機確認後才看得到') }}</label>
          <PhoneField id="seat-phone" v-model:country="form.passengerCountry" v-model:phone="form.passengerPhone" />
        </div>
        <label class="line-field">
          <span>{{ t('微信號（選填）') }}</span>
          <input v-model="form.passengerWechat" class="line-input" maxlength="60" />
        </label>
        <label class="line-field">
          <span>{{ t('備註（選填）') }}</span>
          <textarea v-model="form.notes" class="line-input" maxlength="300" :placeholder="t('例如：航班號碼、帶嬰兒車')" />
        </label>
        <button class="button block large" type="submit" :disabled="busy">{{ t('送出報位') }}</button>
      </form>

      <footer class="carpool-public__footer hint">
        <p>{{ t('這趟拼車由司機自己安排。師傅幫不審核司機，也不擔保服務；車費由你和司機自行約定並直接支付，平台不收款。') }}</p>
        <p><RouterLink to="/support">{{ t('檢舉這個拼車') }}</RouterLink></p>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.carpool-public__title {
  margin: var(--space-sm) 0 var(--space-md);
}
.carpool-public__trip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.carpool-public__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.carpool-public__route {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.carpool-public__line {
  margin: 0;
  color: var(--color-text-secondary);
}
.carpool-public__price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 var(--space-md);
  margin-top: var(--space-xs);
}
.carpool-public__price strong {
  color: var(--color-gold-ink);
  font-size: 20px;
}
.carpool-public__price span {
  color: var(--color-text-secondary);
}
.carpool-public__seats {
  margin: 0;
  font-weight: 700;
}
.carpool-public__note {
  align-self: stretch;
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.carpool-public__policy {
  margin: 0;
  white-space: pre-wrap;
}
.carpool-public__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
.carpool-public__total {
  margin: calc(-1 * var(--space-sm)) 0 var(--space-md);
  color: var(--color-gold-ink);
  font-weight: 700;
}
.carpool-public__gap {
  margin-bottom: var(--space-lg);
}
.carpool-public__footer {
  margin-top: var(--space-xl);
  line-height: 1.6;
}
</style>
