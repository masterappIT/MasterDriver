<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText } from '../api';
import RevealSelect from '../components/RevealSelect.vue';
import { fromLocalInput, toLocalInput } from '../format';
import { t } from '../i18n';

interface PastOrder {
  id: string;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  notes: string | null;
  driverPrice: { amount: number; currency: string } | null;
  passengerPrice?: { amount: number; currency: string } | null;
  showPassengerPrice?: boolean;
}

const router = useRouter();
const past = ref<PastOrder[]>([]);
const busy = ref(false);
const error = ref('');
const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
const form = reactive({
  pickupAt: toLocalInput(inAnHour),
  origin: '',
  destination: '',
  waypoints: [] as string[],
  passengers: '1',
  luggage: '0',
  vehicleType: '',
  currency: 'HKD',
  driverPrice: '',
  passengerPrice: '',
  showPassengerPrice: false,
  notes: '',
  passengerName: '',
  passengerContact: '',
  contactRevealMinutes: 60 as number | null,
});

/** Places used before, most recent first: one tap fills them in. */
const places = computed(() => [...new Set(past.value.flatMap((order) => [order.origin, order.destination]))].slice(0, 6));

const margin = computed(() => {
  if (!form.driverPrice || !form.passengerPrice) return null;
  return Number(form.passengerPrice) - Number(form.driverPrice);
});

/** Repeats the last order's route and prices; the time and passenger are left for this trip. */
function copyLast() {
  const last = past.value[0];
  if (!last) return;
  Object.assign(form, {
    origin: last.origin,
    destination: last.destination,
    waypoints: [...last.waypoints],
    passengers: String(last.passengers),
    luggage: String(last.luggage),
    vehicleType: last.vehicleType ?? '',
    notes: last.notes ?? '',
    currency: last.driverPrice?.currency ?? 'HKD',
    driverPrice: last.driverPrice ? String(last.driverPrice.amount) : '',
    passengerPrice: last.passengerPrice ? String(last.passengerPrice.amount) : '',
    showPassengerPrice: last.showPassengerPrice ?? false,
  });
}

function fillPlace(place: string) {
  if (!form.origin) form.origin = place;
  else if (!form.destination) form.destination = place;
}

const price = (value: string) => (value ? { amount: Number(value), currency: form.currency } : undefined);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const created = await api<{ id: string }>('POST', '/orders', {
      pickupAt: fromLocalInput(form.pickupAt),
      origin: form.origin,
      destination: form.destination,
      waypoints: form.waypoints.filter((stop) => stop.trim()),
      passengers: Number(form.passengers),
      luggage: Number(form.luggage),
      vehicleType: form.vehicleType,
      driverPrice: price(form.driverPrice),
      passengerPrice: price(form.passengerPrice),
      showPassengerPrice: form.showPassengerPrice,
      notes: form.notes,
      passengerName: form.passengerName,
      passengerContact: form.passengerContact,
      contactRevealMinutes: form.contactRevealMinutes,
    });
    await router.replace(`/app/orders/${created.id}?sent=1`);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const [orders, preferences] = await Promise.all([
    api<PastOrder[]>('GET', '/orders?role=dispatched').catch(() => []),
    api<{ contactRevealMinutes: number | null }>('GET', '/me/preferences').catch(() => null),
  ]);
  past.value = orders;
  if (preferences) form.contactRevealMinutes = preferences.contactRevealMinutes;
});
</script>

<template>
  <form class="page new-order" @submit.prevent="submit">
    <div class="new-order__head">
      <h1>{{ t('發單') }}</h1>
      <button v-if="past.length" class="button secondary" type="button" @click="copyLast">{{ t('複製上一張') }}</button>
    </div>
    <div v-if="error" class="notice error">{{ error }}</div>

    <div class="card">
      <label class="field">{{ t('出發時間（香港時間）') }}<input v-model="form.pickupAt" class="input" type="datetime-local" required /></label>
      <label class="field">{{ t('出發地') }}<input v-model="form.origin" class="input" maxlength="120" :placeholder="t('例如：深圳灣口岸')" required /></label>
      <div v-for="(_, index) in form.waypoints" :key="index" class="field">
        {{ t(`途經點 ${index + 1}`) }}
        <div class="row new-order__waypoint">
          <input v-model="form.waypoints[index]" class="input" maxlength="120" />
          <button class="button secondary" type="button" @click="form.waypoints.splice(index, 1)">{{ t('刪除') }}</button>
        </div>
      </div>
      <button v-if="form.waypoints.length < 5" class="chip new-order__add" type="button" @click="form.waypoints.push('')">＋ {{ t('加途經點') }}</button>
      <label class="field">{{ t('目的地') }}<input v-model="form.destination" class="input" maxlength="120" :placeholder="t('例如：香港國際機場')" required /></label>
      <div v-if="places.length" class="chips">
        <span class="hint">{{ t('常用：') }}</span>
        <button v-for="place in places" :key="place" class="chip" type="button" @click="fillPlace(place)">{{ t(place) }}</button>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <label class="field new-order__third">{{ t('人數') }}<input v-model="form.passengers" class="input" type="number" min="1" max="60" inputmode="numeric" required /></label>
        <label class="field new-order__third">{{ t('行李') }}<input v-model="form.luggage" class="input" type="number" min="0" max="60" inputmode="numeric" /></label>
        <label class="field new-order__third">{{ t('車型') }}<input v-model="form.vehicleType" class="input" maxlength="30" :placeholder="t('7座')" /></label>
      </div>
      <label class="field">{{ t('備註') }}<textarea v-model="form.notes" class="textarea" maxlength="500" :placeholder="t('例如：需要兒童座椅')" /></label>
    </div>

    <div class="card">
      <h2>{{ t('價格') }}</h2>
      <div class="row">
        <label class="field new-order__currency">
          {{ t('幣種') }}
          <select v-model="form.currency" class="select">
            <option value="HKD">HK$</option>
            <option value="CNY">RMB¥</option>
            <option value="MOP">MOP$</option>
          </select>
        </label>
        <label class="field new-order__price">{{ t('司機價（群裡看得到）') }}<input v-model="form.driverPrice" class="input" type="number" min="0" step="0.01" inputmode="decimal" /></label>
      </div>
      <label class="field">{{ t('乘客價（只有你看得到）') }}<input v-model="form.passengerPrice" class="input" type="number" min="0" step="0.01" inputmode="decimal" /></label>
      <label class="row"><input v-model="form.showPassengerPrice" type="checkbox" /> {{ t('讓乘客在確認頁看到乘客價') }}</label>
      <p v-if="margin !== null" class="hint">{{ t(`差價：${margin}`) }}</p>
    </div>

    <div class="card">
      <h2>{{ t('乘客') }} <span class="hint">🔒 {{ t('只有搶到單的司機，在你設定的時間後才看得到') }}</span></h2>
      <label class="field">{{ t('乘客稱呼（選填）') }}<input v-model="form.passengerName" class="input" maxlength="40" /></label>
      <label class="field">{{ t('乘客電話或微信') }}<input v-model="form.passengerContact" class="input" maxlength="60" required /></label>
      <label class="field">
        {{ t('接單司機何時看到乘客電話') }}
        <RevealSelect v-model="form.contactRevealMinutes" />
        <span class="hint">{{ t('在這之前，司機只能聯絡你。預設值可在「我的」修改。') }}</span>
      </label>
    </div>

    <div class="action-bar">
      <button class="button block large" type="submit" :disabled="busy">{{ t('發出') }}</button>
    </div>
  </form>
</template>

<style scoped>
.new-order {
  padding-bottom: calc(100px + var(--safe-bottom));
}
.new-order__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.new-order__waypoint {
  flex-wrap: nowrap;
}
.new-order__add {
  margin-bottom: var(--space-md);
}
.new-order__third {
  flex: 1;
  min-width: 0;
}
.new-order__currency {
  width: 100px;
}
.new-order__price {
  flex: 1;
  min-width: 0;
}
</style>
