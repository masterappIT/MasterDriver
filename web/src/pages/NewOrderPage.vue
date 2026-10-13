<script setup lang="ts">
import { parseQuickOrder } from '@masterdriver/shared/quick-order';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import RevealSelect from '../components/RevealSelect.vue';
import { fromLocalInput, pickup, toLocalInput } from '../format';
import { t } from '../i18n';
import { PLATE_NAMES, type PlateRegion } from '../journey';

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

interface PreviousLeg {
  id: string;
  pickupAt: string;
  origin: string;
  destination: string;
  passengers: number;
  luggage: number;
  passengerName: string | null;
  passengerContact: string | null;
  contactRevealMinutes?: number | null;
  driverPrice: { amount: number; currency: string } | null;
  journey: { legIndex: number } | null;
}

const route = useRoute();
const router = useRouter();
/** 加接駁段: this order follows the order in ?after= as the next leg of the trip. */
const afterId = typeof route.query.after === 'string' ? route.query.after : '';
const previous = ref<PreviousLeg | null>(null);
const legNumber = computed(() => (previous.value?.journey?.legIndex ?? 1) + 1);
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
  /** 直達 (false) or 接駁 (true): with 接駁 this order ends at the 接駁位置. */
  transfer: false,
  requiredPlates: [] as PlateRegion[],
  selfDrive: false,
});

/** Places used before, most recent first: one tap fills them in. */
const places = computed(() => [...new Set(past.value.flatMap((order) => [order.origin, order.destination]))].slice(0, 6));

/**
 * 一句話發單: type the order the way it is written in the group; the form below
 * is filled in from it and stays fully editable. Nothing is sent until "發出".
 */
const line = ref('');
const filledFromLine = ref<string[]>([]);

function fillFromLine() {
  const parsed = parseQuickOrder(line.value);
  const filled: string[] = [];
  if (parsed.pickupAt) {
    form.pickupAt = parsed.pickupAt.slice(0, 16);
    filled.push(`時間 ${pickup(parsed.pickupAt)}`);
  }
  if (parsed.origin) {
    form.origin = parsed.origin;
    filled.push(`出發地 ${parsed.origin}`);
  }
  if (parsed.destination) {
    form.destination = parsed.destination;
    filled.push(`目的地 ${parsed.destination}`);
  }
  if (parsed.passengers) {
    form.passengers = String(parsed.passengers);
    filled.push(`${parsed.passengers}人`);
  }
  if (parsed.luggage !== undefined) {
    form.luggage = String(parsed.luggage);
    filled.push(`${parsed.luggage}件行李`);
  }
  if (parsed.vehicleType) {
    form.vehicleType = parsed.vehicleType;
    filled.push(parsed.vehicleType);
  }
  if (parsed.price) {
    form.currency = parsed.price.currency;
    form.driverPrice = String(parsed.price.amount);
    filled.push(`司機價 ${parsed.price.amount}`);
  }
  if (parsed.notes) {
    form.notes = parsed.notes;
    filled.push(`備註 ${parsed.notes}`);
  }
  filledFromLine.value = filled;
}

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
      rawText: line.value.trim() || undefined,
      passengerName: form.passengerName,
      passengerContact: form.passengerContact,
      contactRevealMinutes: form.contactRevealMinutes,
      afterOrderId: afterId || undefined,
      transfer: !afterId && form.transfer,
      requiredPlates: afterId || form.transfer ? form.requiredPlates : [],
      selfDrive: form.selfDrive,
    });
    await router.replace(`/app/orders/${created.id}?sent=1`);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

/** The next leg carries the same passenger and starts where and after the previous leg ends. */
async function loadPrevious() {
  try {
    const leg = await api<PreviousLeg>('GET', `/orders/${afterId}`);
    previous.value = leg;
    Object.assign(form, {
      pickupAt: toLocalInput(new Date(new Date(leg.pickupAt).getTime() + 60 * 60 * 1000)),
      origin: leg.destination,
      passengers: String(leg.passengers),
      luggage: String(leg.luggage),
      passengerName: leg.passengerName ?? '',
      passengerContact: leg.passengerContact ?? '',
      contactRevealMinutes: leg.contactRevealMinutes ?? null,
      currency: leg.driverPrice?.currency ?? form.currency,
    });
  } catch (e) {
    error.value = errorText(e);
  }
}

onMounted(async () => {
  const [orders, preferences] = await Promise.all([
    api<PastOrder[]>('GET', '/orders?role=dispatched').catch(() => []),
    api<{ contactRevealMinutes: number | null }>('GET', '/me/preferences').catch(() => null),
  ]);
  past.value = orders;
  if (preferences) form.contactRevealMinutes = preferences.contactRevealMinutes;
  if (afterId) await loadPrevious();
});
</script>

<template>
  <form class="page new-order" @submit.prevent="submit">
    <div class="new-order__head">
      <h1>{{ afterId ? t(`加接駁段（第 ${legNumber} 段）`) : t('發單') }}</h1>
      <button v-if="past.length && !afterId" class="button secondary" type="button" @click="copyLast">{{ t('複製上一張') }}</button>
    </div>
    <div v-if="error" class="notice error">{{ error }}</div>

    <div v-if="previous" class="card">
      <p class="hint new-order__previous-label">{{ t(`接在第 ${legNumber - 1} 段後面`) }}</p>
      <strong>{{ pickup(previous.pickupAt) }}</strong>
      <div>{{ t(previous.origin) }} → {{ t(previous.destination) }}</div>
      <p class="hint">{{ t('同一位乘客，已帶入接駁位置、人數、行李和乘客資料。這一段另外貼到群裡搶，平台服務費整個行程只收一次。') }}</p>
    </div>

    <div v-if="!afterId" class="card quick-line">
      <label class="field">
        {{ t('一句話發單') }}
        <textarea
          v-model="line"
          class="textarea quick-line__input"
          maxlength="300"
          :placeholder="t('照群裡的寫法輸入或貼上，例如：明天15:40澳門送惠州博羅灣 直車 7座')"
        />
      </label>
      <button class="button secondary block" type="button" :disabled="!line.trim()" @click="fillFromLine">{{ t('自動填入下方表格') }}</button>
      <p v-if="filledFromLine.length" class="hint quick-line__filled">
        {{ t(`已填入：${filledFromLine.join('、')}。請核對並補齊其餘資料。`) }}
      </p>
    </div>

    <div class="card">
      <div v-if="!afterId" class="row new-order__mode">
        <label class="row"><input v-model="form.transfer" type="radio" name="mode" :value="false" /> {{ t('直達（一部車到底）') }}</label>
        <label class="row"><input v-model="form.transfer" type="radio" name="mode" :value="true" /> {{ t('接駁（中途換車）') }}</label>
      </div>
      <p v-if="form.transfer && !afterId" class="hint new-order__add">
        {{ t('這張單是第 1 段，目的地填接駁位置。發出後按「加接駁段」發下一段。乘客自行過關不算接駁。') }}
      </p>
      <label class="field">{{ t('出發時間（香港時間）') }}<input v-model="form.pickupAt" class="input" type="datetime-local" required /></label>
      <label class="field">
        {{ afterId ? t('接駁位置（這一段的出發地）') : t('出發地') }}
        <input v-model="form.origin" class="input" maxlength="120" :placeholder="afterId ? '' : t('例如：深圳灣口岸')" required />
        <span v-if="previous && form.origin.trim() !== previous.destination" class="hint">{{ t('上一段的目的地會一起改成這個接駁位置。') }}</span>
      </label>
      <div v-for="(_, index) in form.waypoints" :key="index" class="field">
        {{ t(`途經點 ${index + 1}`) }}
        <div class="row new-order__waypoint">
          <input v-model="form.waypoints[index]" class="input" maxlength="120" />
          <button class="button secondary" type="button" @click="form.waypoints.splice(index, 1)">{{ t('刪除') }}</button>
        </div>
      </div>
      <button v-if="form.waypoints.length < 5" class="chip new-order__add" type="button" @click="form.waypoints.push('')">＋ {{ t('加途經點') }}</button>
      <label class="field">
        {{ form.transfer && !afterId ? t('接駁位置（這一段的目的地）') : t('目的地') }}
        <input v-model="form.destination" class="input" maxlength="120" :placeholder="form.transfer && !afterId ? t('自己輸入換車的地點') : t('例如：香港國際機場')" required />
      </label>
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
      <div v-if="afterId || form.transfer" class="field">
        {{ t('這一段需要的車牌（選填）') }}
        <div class="row">
          <label v-for="(name, region) in PLATE_NAMES" :key="region" class="row">
            <input v-model="form.requiredPlates" type="checkbox" :value="region" /> {{ t(name) }}
          </label>
        </div>
        <span class="hint">{{ t('只在群文字和搶單頁標明，平台不審核車牌，任何司機都可以搶。') }}</span>
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

    <div class="card">
      <label class="row"><input v-model="form.selfDrive" type="checkbox" /> {{ t('這段我自己做（不放到群裡搶）') }}</label>
      <p v-if="form.selfDrive" class="hint">
        {{ session.profile ? t('這張單直接算你接，乘客確認頁會顯示你的車牌。之後可按「放到群裡搶」改派。') : t('請先在「我的」填寫司機資料（姓名、車牌），乘客確認頁會顯示。') }}
      </p>
    </div>

    <div class="action-bar">
      <button class="button block large" type="submit" :disabled="busy || (afterId !== '' && !previous)">{{ afterId ? t('發出接駁段') : t('發出') }}</button>
    </div>
  </form>
</template>

<style scoped>
.new-order {
  padding-bottom: calc(100px + var(--safe-bottom));
}
.quick-line__input {
  min-height: 64px;
}
.quick-line__filled {
  margin: var(--space-sm) 0 0;
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
.new-order__previous-label {
  margin: 0 0 var(--space-xs);
}
.new-order__mode {
  gap: var(--space-lg);
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
