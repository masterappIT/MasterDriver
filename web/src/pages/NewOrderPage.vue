<script setup lang="ts">
import { COUNTRY_CODES, type CountryCode, formatPassengerPhone, isValidPassengerPhone, splitPassengerPhone } from '@masterdriver/shared/phone';
import { parseQuickOrder } from '@masterdriver/shared/quick-order';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import RevealSelect, { revealLabel } from '../components/RevealSelect.vue';
import { fromLocalInput, pickup, toLocalInput } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { PLATE_NAMES, type PlateRegion } from '../journey';
import AppIcon from '../components/AppIcon.vue';
import BottomSheet from '../components/BottomSheet.vue';
import { pickedPassenger, type BookPassenger } from '../passenger-pick';

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
  status: string;
  selfDrive?: boolean;
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
/** 成單: this order is made from a booking request sent through the 名片頁. */
const bookingId = typeof route.query.booking === 'string' ? route.query.booking : '';
const fromBooking = ref(false);
const previous = ref<PreviousLeg | null>(null);
const legNumber = computed(() => (previous.value?.journey?.legIndex ?? 1) + 1);
/** The 接駁位置 can still move while no other driver holds the previous leg. */
const placeLocked = computed(() => Boolean(previous.value && previous.value.status !== 'OPEN' && !previous.value.selfDrive));
const past = ref<PastOrder[]>([]);
const busy = ref(false);
const error = ref('');
const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
/** The dispatcher's own country code is the likeliest one for their passengers. */
function defaultCountry(): CountryCode {
  const own = session.user?.countryCode;
  return (COUNTRY_CODES as readonly string[]).includes(own ?? '') ? (own as CountryCode) : '+852';
}

/** A contact brought over from an earlier leg or a booking that is not a phone, shown so it can be retyped. */
const carriedContact = ref('');

/** Fills the phone fields from a contact written earlier, or keeps it aside when it is not a phone. */
function carryContact(raw: string | null | undefined) {
  const parts = raw ? splitPassengerPhone(raw) : null;
  if (parts) {
    form.passengerCountry = parts.countryCode;
    form.passengerPhone = parts.phone;
    carriedContact.value = '';
  } else {
    form.passengerPhone = '';
    carriedContact.value = raw ?? '';
  }
}

const form = reactive({
  pickupAt: toLocalInput(inAnHour),
  origin: '',
  destination: '',
  waypoints: [] as string[],
  passengers: '1',
  luggage: '0',
  vehicleType: '',
  /** The driver price's currency. */
  currency: 'HKD',
  driverPrice: '',
  /** The passenger price's own currency: it follows the driver price's until the dispatcher picks another. */
  passengerCurrency: 'HKD',
  passengerPrice: '',
  showPassengerPrice: false,
  notes: '',
  passengerName: '',
  /** The passenger's phone: a country code and the number; passengers do not give a WeChat ID here. */
  passengerCountry: defaultCountry(),
  passengerPhone: '',
  contactRevealMinutes: 60 as number | null,
  /** 直達 (false) or 接駁 (true): with 接駁 this order ends at the 接駁位置. */
  transfer: false,
  requiredPlates: [] as PlateRegion[],
  selfDrive: false,
  /** 接單池: also list the order for every signed-in driver, not only the groups the link is pasted in. */
  inPool: false,
  /** 收款方式: show the dispatcher's ways to be paid on the passenger's confirmation page. */
  showPaymentMethods: false,
});
/** How many 收款方式 the dispatcher has set; with none there is nothing to show the passenger. */
const paymentMethodCount = ref<number | null>(null);

/** Places used before, most recent first: one tap fills them in. */
const places = computed(() => [...new Set(past.value.flatMap((order) => [order.origin, order.destination]))].slice(0, 6));

/**
 * 一句話出單: type the order the way it is written in the group; the form below
 * is filled in from it and stays fully editable. Nothing is sent until "出單".
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
    filled.push(`出單價 ${parsed.price.amount}`);
  }
  if (parsed.notes) {
    form.notes = parsed.notes;
    filled.push(`備註 ${parsed.notes}`);
  }
  filledFromLine.value = filled;
}

/** Set once the passenger price's currency was picked, or came with the order being copied or the booking. */
const passengerCurrencyChosen = ref(false);
watch(
  () => form.currency,
  (currency) => {
    if (!passengerCurrencyChosen.value) form.passengerCurrency = currency;
  },
);

/** The spread, only when both prices are in the same currency (the API counts it the same way). */
const margin = computed(() => {
  if (!form.driverPrice || !form.passengerPrice || form.currency !== form.passengerCurrency) return null;
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
    passengerCurrency: last.passengerPrice?.currency ?? last.driverPrice?.currency ?? 'HKD',
    passengerPrice: last.passengerPrice ? String(last.passengerPrice.amount) : '',
    showPassengerPrice: last.showPassengerPrice ?? false,
  });
  passengerCurrencyChosen.value = Boolean(last.passengerPrice);
}

function togglePlate(region: PlateRegion) {
  form.requiredPlates = form.requiredPlates.includes(region) ? form.requiredPlates.filter((item) => item !== region) : [...form.requiredPlates, region];
}

function fillPlace(place: string) {
  if (!form.origin) form.origin = place;
  else if (!form.destination) form.destination = place;
}

const price = (value: string, currency: string) => (value ? { amount: Number(value), currency } : undefined);

async function submit() {
  error.value = '';
  // Checked here first so the driver hears about a wrong number before anything is sent; the API checks it again.
  if (!isValidPassengerPhone(form.passengerCountry, form.passengerPhone)) {
    error.value = t(form.passengerCountry === '+86' ? '乘客電話請填 11 位內地手機號碼' : '乘客電話請填 8 位數字');
    document.getElementById('passenger-phone')?.focus();
    return;
  }
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
      driverPrice: price(form.driverPrice, form.currency),
      passengerPrice: price(form.passengerPrice, form.passengerCurrency),
      showPassengerPrice: form.showPassengerPrice,
      notes: form.notes,
      rawText: line.value.trim() || undefined,
      passengerName: form.passengerName,
      passengerContact: formatPassengerPhone(form.passengerCountry, form.passengerPhone),
      contactRevealMinutes: form.contactRevealMinutes,
      afterOrderId: afterId || undefined,
      bookingId: fromBooking.value ? bookingId : undefined,
      transfer: !afterId && form.transfer,
      requiredPlates: afterId || form.transfer ? form.requiredPlates : [],
      selfDrive: form.selfDrive,
      inPool: !form.selfDrive && form.inPool,
      // A leg follows its trip's choice; the server takes it from the first leg.
      showPaymentMethods: !afterId && form.showPaymentMethods,
    });
    // Straight to the texts to paste: getting the order into the groups is the point of dispatching.
    await router.replace(`/app/orders/${created.id}/share`);
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
      contactRevealMinutes: leg.contactRevealMinutes ?? null,
      currency: leg.driverPrice?.currency ?? form.currency,
    });
    carryContact(leg.passengerContact);
  } catch (e) {
    error.value = errorText(e);
  }
}

/** The passenger's request fills the form; the quote becomes the passenger price, shown on their confirmation page. */
async function loadBooking() {
  try {
    const booking = await api<{
      pickupAt: string;
      origin: string;
      destination: string;
      passengers: number;
      luggage: number;
      passengerName: string | null;
      passengerContact: string;
      notes: string | null;
      quote: { amount: number; currency: string } | null;
    }>('GET', `/me/bookings/${bookingId}`);
    Object.assign(form, {
      pickupAt: toLocalInput(new Date(booking.pickupAt)),
      origin: booking.origin,
      destination: booking.destination,
      passengers: String(booking.passengers),
      luggage: String(booking.luggage),
      passengerName: booking.passengerName ?? '',
      notes: booking.notes ?? '',
      ...(booking.quote
        ? { currency: booking.quote.currency, passengerCurrency: booking.quote.currency, passengerPrice: String(booking.quote.amount), showPassengerPrice: true }
        : {}),
    });
    if (booking.quote) passengerCurrencyChosen.value = true;
    // A phone the driver added on the booking's page comes in the navigation state, not the address.
    const added = (window.history.state as { passengerContact?: unknown } | null)?.passengerContact;
    carryContact(typeof added === 'string' ? added : booking.passengerContact);
    fromBooking.value = true;
  } catch (e) {
    error.value = errorText(e);
  }
}

/** What the folded 更多設定 currently says, so nothing is hidden by surprise. */
const moreSummary = computed(() =>
  [
    `乘客電話：${revealLabel(form.contactRevealMinutes)}`,
    form.selfDrive ? '這單我自己做' : form.inPool ? '放進接單池' : '只給拿到連結的人',
  ].join(' · '),
);

/** 客人通訊錄: pick a passenger of an earlier order instead of typing the name and phone again. */
const book = ref<BookPassenger[] | null>(null);
const pickingPassenger = ref(false);

async function openBook() {
  pickingPassenger.value = true;
  if (!book.value) book.value = await api<BookPassenger[]>('GET', '/orders/passengers').catch(() => []);
}

function usePassenger(passenger: BookPassenger) {
  form.passengerName = passenger.name ?? '';
  carryContact(passenger.contact);
  pickingPassenger.value = false;
}

/** From 首頁「貼群文字」: start with the cursor in the one-line box, ready to paste. */
const lineInput = ref<HTMLTextAreaElement | null>(null);

onMounted(async () => {
  if (route.query.paste === '1') lineInput.value?.focus();
  const [orders, preferences] = await Promise.all([
    api<PastOrder[]>('GET', '/orders?role=dispatched').catch(() => []),
    api<{ contactRevealMinutes: number | null; poolByDefault: boolean }>('GET', '/me/preferences').catch(() => null),
  ]);
  past.value = orders;
  void api<unknown[]>('GET', '/me/payment-methods')
    .then((methods) => (paymentMethodCount.value = methods.length))
    .catch(() => (paymentMethodCount.value = null));
  if (preferences) {
    form.contactRevealMinutes = preferences.contactRevealMinutes;
    form.inPool = preferences.poolByDefault;
  }
  if (afterId) await loadPrevious();
  else if (bookingId) await loadBooking();
  else if (pickedPassenger.value) usePassenger(pickedPassenger.value);
  pickedPassenger.value = null;
});
</script>

<template>
  <form class="page new-order" @submit.prevent="submit">
    <PageBack :title="afterId ? t(`加接駁段（第 ${legNumber} 段）`) : t('出單')" :fallback="afterId ? `/app/orders/${afterId}` : bookingId ? `/app/bookings/${bookingId}` : '/app'" history>
      <button v-if="past.length && !afterId" class="chip new-order__copy" type="button" @click="copyLast">{{ t('複製上一張') }}</button>
    </PageBack>
    <div v-if="error" class="notice error">{{ error }}</div>

    <div v-if="previous" class="new-order__previous">
      <span class="section-label">{{ t(`接在第 ${legNumber - 1} 段後面`) }}</span>
      <strong>{{ pickup(previous.pickupAt) }}　{{ t(`${previous.origin} 至 ${previous.destination}`) }}</strong>
      <p class="hint">{{ t('同一位乘客，已帶入接駁位置、人數、行李和乘客資料。這一段另外貼到群裡搶，平台服務費整個行程只收一次。') }}</p>
    </div>

    <div v-if="fromBooking" class="notice">
      {{ form.passengerPrice ? t('已帶入名片頁預約的資料和你的報價（作為乘客價）。填出單價後出單，貼到群裡派給其他司機。') : t('已帶入名片頁預約的資料。填出單價後出單，貼到群裡派給其他司機。') }}
    </div>

    <!-- 一句話出單: written like a message in the group, so it looks like one. -->
    <div v-if="!afterId && !fromBooking" class="quick-line">
      <textarea
        ref="lineInput"
        v-model="line"
        class="quick-line__input"
        maxlength="300"
        :aria-label="t('一句話出單')"
        :placeholder="t('照群裡的寫法貼上一句，例如：明天15:40澳門送香港 直車 7座')"
      />
      <div class="quick-line__foot">
        <span class="hint">{{ filledFromLine.length ? t(`已填入：${filledFromLine.join('、')}。請核對下面。`) : t('一句話出單，自動填好下面') }}</span>
        <button class="button quick-line__fill" type="button" :disabled="!line.trim()" @click="fillFromLine">{{ t('自動填入') }}</button>
      </div>
    </div>

    <section class="card">
      <div v-if="!afterId" class="segment segment--block new-order__mode" role="group" :aria-label="t('直達或接駁')">
        <button type="button" :aria-pressed="!form.transfer" @click="form.transfer = false">{{ t('直達') }}</button>
        <button type="button" :aria-pressed="form.transfer" @click="form.transfer = true">{{ t('接駁（中途換車）') }}</button>
      </div>
      <p v-if="form.transfer && !afterId" class="hint new-order__explain">
        {{ t('這張單是第 1 段，目的地填接駁位置。出單後按「加接駁段」出下一段。乘客自行過關不算接駁。') }}
      </p>

      <label class="line-field">
        <span>{{ t('出發時間（香港時間）') }}</span>
        <input v-model="form.pickupAt" class="line-input new-order__time" type="datetime-local" required />
      </label>

      <!-- The route as dots on a line, the way the claim page shows it. -->
      <ol class="route-inputs">
        <li class="route-inputs__stop route-inputs__stop--origin">
          <input
            v-model="form.origin"
            class="line-input"
            maxlength="120"
            :aria-label="afterId ? t('接駁位置（這一段的出發地）') : t('出發地')"
            :placeholder="afterId ? t('接駁位置') : t('從哪裡出發，例如：深圳灣口岸')"
            required
          />
          <span v-if="previous && form.origin.trim() !== previous.destination" class="hint">
            {{ placeLocked ? t('上一段已有司機接單，接駁位置要和上一段的目的地相同；要改請先改派上一段。') : t('上一段的目的地會一起改成這個接駁位置。') }}
          </span>
        </li>
        <li v-for="(_, index) in form.waypoints" :key="index" class="route-inputs__stop route-inputs__stop--via">
          <div class="new-order__via">
            <input v-model="form.waypoints[index]" class="line-input" maxlength="120" :aria-label="t(`途經點 ${index + 1}`)" :placeholder="t('途經')" />
            <button class="new-order__remove" type="button" :aria-label="t(`刪除途經點 ${index + 1}`)" @click="form.waypoints.splice(index, 1)">
              <AppIcon name="close" :size="18" />
            </button>
          </div>
        </li>
        <li class="route-inputs__stop route-inputs__stop--destination">
          <input
            v-model="form.destination"
            class="line-input"
            maxlength="120"
            :aria-label="form.transfer && !afterId ? t('接駁位置（這一段的目的地）') : t('目的地')"
            :placeholder="form.transfer && !afterId ? t('在哪裡換車（接駁位置）') : t('去哪裡，例如：香港國際機場')"
            required
          />
        </li>
      </ol>
      <div class="chips new-order__places">
        <button v-if="form.waypoints.length < 5" class="chip" type="button" @click="form.waypoints.push('')">{{ t('加途經點') }}</button>
        <button v-for="place in places" :key="place" class="chip" type="button" @click="fillPlace(place)">{{ t(place) }}</button>
      </div>
    </section>

    <section class="card">
      <div class="new-order__load">
        <label class="line-field">
          <span>{{ t('人數') }}</span>
          <input v-model="form.passengers" class="line-input" type="number" min="1" max="60" inputmode="numeric" required />
        </label>
        <label class="line-field">
          <span>{{ t('行李') }}</span>
          <input v-model="form.luggage" class="line-input" type="number" min="0" max="60" inputmode="numeric" />
        </label>
        <label class="line-field">
          <span>{{ t('車型') }}</span>
          <input v-model="form.vehicleType" class="line-input" maxlength="30" :placeholder="t('7座')" />
        </label>
      </div>
      <div v-if="afterId || form.transfer" class="line-field">
        <span>{{ t('這一段要甚麼車牌（選填）') }}</span>
        <div class="chips new-order__plates">
          <button
            v-for="(name, region) in PLATE_NAMES"
            :key="region"
            class="chip"
            :class="{ 'chip--on': form.requiredPlates.includes(region) }"
            type="button"
            :aria-pressed="form.requiredPlates.includes(region)"
            @click="togglePlate(region)"
          >
            {{ t(name) }}
          </button>
        </div>
        <span class="hint">{{ t('只在群文字和搶單頁標明，平台不審核車牌，任何司機都可以搶。') }}</span>
      </div>
      <label class="line-field new-order__last">
        <span>{{ t('備註') }}</span>
        <textarea v-model="form.notes" class="line-input" maxlength="500" :placeholder="t('例如：需要兒童座椅')" />
      </label>
    </section>

    <section class="card">
      <span class="section-label">{{ t('出單價，拿到連結的司機看得到') }}</span>
      <div class="amount-line">
        <select v-model="form.currency" :aria-label="t('幣種')">
          <option value="HKD">HK$</option>
          <option value="CNY">RMB¥</option>
          <option value="MOP">MOP$</option>
        </select>
        <input v-model="form.driverPrice" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('出單價')" :placeholder="t('出單價')" />
      </div>
      <span class="section-label new-order__passenger-price">{{ t('乘客價，只有你看得到') }}</span>
      <div class="amount-line amount-line--quiet">
        <select v-model="form.passengerCurrency" :aria-label="t('乘客價幣種')" @change="passengerCurrencyChosen = true">
          <option value="HKD">HK$</option>
          <option value="CNY">RMB¥</option>
          <option value="MOP">MOP$</option>
        </select>
        <input v-model="form.passengerPrice" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('乘客價')" :placeholder="t('乘客價（選填）')" />
      </div>
      <p v-if="margin !== null" class="new-order__margin">{{ t(`差價 ${margin}`) }}</p>
      <p v-else-if="form.driverPrice && form.passengerPrice" class="hint new-order__margin-none">{{ t('兩個價格幣種不同，不計差價。') }}</p>
      <label class="new-order__switch">
        <span>{{ t('乘客確認頁顯示乘客價') }}</span>
        <input v-model="form.showPassengerPrice" class="switch" type="checkbox" />
      </label>
      <label v-if="!afterId" class="new-order__switch">
        <span>
          {{ t('乘客確認頁顯示收款方式') }}
          <small v-if="paymentMethodCount === 0">
            {{ t('還沒有收款方式，') }}<RouterLink to="/app/payment-methods">{{ t('先去設定') }}</RouterLink>
          </small>
          <small v-else>{{ t('乘客直接付給你，顯示時會一併顯示乘客價') }}</small>
        </span>
        <input v-model="form.showPaymentMethods" class="switch" type="checkbox" :disabled="paymentMethodCount === 0" />
      </label>
    </section>

    <section class="card">
      <div class="new-order__passenger-head">
        <span class="section-label">{{ t('乘客') }}</span>
        <button v-if="past.length" class="new-order__book" type="button" @click="openBook">{{ t('從通訊錄選') }}</button>
      </div>
      <input v-model="form.passengerName" class="line-input new-order__name" maxlength="40" :aria-label="t('乘客稱呼')" :placeholder="t('稱呼（選填），例如：王小姐')" />
      <div class="line-field new-order__last">
        <label for="passenger-phone">{{ t('電話') }}</label>
        <div class="new-order__phone">
          <select v-model="form.passengerCountry" class="new-order__country" :aria-label="t('區號')">
            <option v-for="code in COUNTRY_CODES" :key="code" :value="code">{{ code }}</option>
          </select>
          <input
            id="passenger-phone"
            v-model="form.passengerPhone"
            class="line-input"
            type="tel"
            inputmode="tel"
            autocomplete="off"
            maxlength="20"
            :placeholder="form.passengerCountry === '+86' ? t('11 位手機號碼') : t('8 位數字')"
            required
          />
        </div>
        <span v-if="carriedContact" class="hint new-order__carried">{{ t(`原本留的聯絡方式是「${carriedContact}」，不是電話號碼，請向乘客要電話後填上。`) }}</span>
      </div>
      <p class="hint new-order__private">{{ t('只有搶到單的司機，在你設定的時間後才看得到乘客電話。') }}</p>
    </section>

    <!-- Settings most orders leave at the driver's defaults; folded so the form shows only what must be filled. -->
    <details class="card new-order__more" :open="fromBooking || form.selfDrive">
      <summary>
        <span class="new-order__more-text">
          <strong>{{ t('更多設定') }}</strong>
          <span class="hint">{{ t(moreSummary) }}</span>
        </span>
        <AppIcon name="chevron" class="new-order__more-arrow" />
      </summary>
      <label class="new-order__switch">
        <span>
          {{ t('乘客電話給接單司機看') }}
          <small>{{ t('在這之前，司機只能聯絡你；行程完成或取消後，司機就看不到乘客電話') }}</small>
        </span>
        <RevealSelect v-model="form.contactRevealMinutes" class="select--inline" />
      </label>
      <label class="new-order__switch">
        <span>
          {{ t('這單我自己做') }}
          <small>
            {{
              !form.selfDrive
                ? t('不放到群裡搶')
                : session.profile
                  ? t('直接算你接，乘客確認頁顯示你的車牌；之後可以改派')
                  : t('請先在「我的」填寫司機資料，乘客確認頁會顯示')
            }}
          </small>
        </span>
        <input v-model="form.selfDrive" class="switch" type="checkbox" />
      </label>
      <label v-if="!form.selfDrive" class="new-order__switch">
        <span>
          {{ t('同時放到接單池') }}
          <small>{{ t('登入的司機都看得到並可以搶，乘客資料仍只給搶到的司機') }}</small>
        </span>
        <input v-model="form.inPool" class="switch" type="checkbox" />
      </label>
    </details>

    <div class="action-bar">
      <button class="button block large" type="submit" :disabled="busy || (afterId !== '' && !previous)">{{ afterId ? t('出單（接駁段）') : t('出單') }}</button>
    </div>

    <BottomSheet v-if="pickingPassenger" :title="t('從通訊錄選乘客')" @close="pickingPassenger = false">
      <p v-if="!book" class="muted">{{ t('載入中…') }}</p>
      <p v-else-if="book.length === 0" class="muted">{{ t('還沒有客人。') }}</p>
      <div v-else class="new-order__book-list">
        <button v-for="passenger in book" :key="passenger.contact" class="new-order__book-item" type="button" @click="usePassenger(passenger)">
          <strong>{{ passenger.name ? t(passenger.name) : t('沒有稱呼') }}</strong>
          <span>{{ passenger.contact }}</span>
          <small>{{ t(passenger.lastRoute) }}</small>
        </button>
      </div>
    </BottomSheet>
  </form>
</template>

<style scoped>
.new-order {
  padding-bottom: calc(100px + var(--safe-bottom));
}
.new-order__copy {
  white-space: nowrap;
}
.new-order__previous {
  display: flex;
  flex-direction: column;
  margin: 0 var(--space-xs) var(--space-lg);
}
.new-order__previous .section-label {
  margin-bottom: 2px;
}
.new-order__previous .hint {
  margin: var(--space-xs) 0 0;
}
/* 一句話出單 looks like a message bubble from the group. */
.quick-line {
  margin-bottom: var(--space-lg);
  padding: var(--space-md) var(--space-md) var(--space-sm);
  border-radius: 4px var(--radius-card) var(--radius-card) var(--radius-card);
  background: var(--color-tint);
}
.quick-line__input {
  display: block;
  width: 100%;
  min-height: 56px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 16px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.quick-line__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}
.quick-line__fill {
  flex-shrink: 0;
  min-height: 36px;
  padding: 0 var(--space-lg);
}
.new-order__mode {
  margin-bottom: var(--space-lg);
}
.new-order__explain {
  margin: calc(var(--space-sm) * -1) 0 var(--space-lg);
}
.new-order__time {
  font-variant-numeric: tabular-nums;
}
.new-order__via {
  display: flex;
  align-items: center;
}
.new-order__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: none;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}
.new-order__places {
  margin-top: var(--space-md);
}
.new-order__load {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr;
  gap: var(--space-md);
}
.new-order__plates {
  margin: var(--space-sm) 0 var(--space-xs);
}
.new-order__last {
  margin-bottom: 0;
}
.new-order__passenger-price {
  margin: var(--space-lg) 0 var(--space-xs);
}
.new-order__margin-none {
  margin: var(--space-sm) 0;
}
.new-order__margin {
  margin: var(--space-sm) 0;
  color: var(--color-teal);
  font-size: var(--font-label);
  font-weight: 700;
}
/* A sentence on the left, its switch or choice on the right. */
.new-order__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 48px;
  padding: var(--space-sm) 0;
  font-weight: 600;
}
.new-order__switch + .new-order__switch {
  border-top: 1px solid var(--color-divider);
}
.new-order__switch > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.new-order__switch small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
.new-order__phone {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.new-order__country {
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
.new-order__phone .line-input {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.new-order__name {
  margin-bottom: var(--space-lg);
}
.new-order__private {
  margin: var(--space-md) 0 0;
}
.new-order__carried {
  display: block;
  margin-top: var(--space-xs);
  color: var(--color-gold-ink);
}
.new-order__more summary {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  list-style: none;
}
.new-order__more summary::-webkit-details-marker {
  display: none;
}
.new-order__more-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.new-order__more-arrow {
  color: var(--color-text-muted);
  transition: transform 0.15s;
}
.new-order__more[open] .new-order__more-arrow {
  transform: rotate(90deg);
}
.new-order__passenger-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
}
.new-order__book {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-label);
  font-weight: 600;
  cursor: pointer;
}
.new-order__book-list {
  display: flex;
  flex-direction: column;
  max-height: 60vh;
  overflow-y: auto;
}
.new-order__book-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--space-md) 0;
  border: none;
  border-top: 1px solid var(--color-divider);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.new-order__book-item:first-child {
  border-top: none;
}
.new-order__book-item small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.new-order__more[open] summary {
  margin-bottom: var(--space-sm);
}
</style>
