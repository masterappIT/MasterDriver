<script setup lang="ts">
import { COUNTRY_CODES, type CountryCode, formatPassengerPhone, isValidPassengerPhone, splitPassengerPhone } from '@masterdriver/shared/phone';
import { parseQuickOrder } from '@masterdriver/shared/quick-order';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import RevealSelect, { revealLabel } from '../components/RevealSelect.vue';
import { fromLocalInput, pickup, toLocalInput } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
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
  /** 接駁: the whole order's end, where its first leg ends at the 接駁位置. */
  journey?: { destination: string } | null;
}

const route = useRoute();
const router = useRouter();
/** 成單: this order is made from a booking request sent through the 名片頁. */
const bookingId = typeof route.query.booking === 'string' ? route.query.booking : '';
/** 出回程單: the order this one goes back from, its route turned around. */
const returnOf = typeof route.query.return === 'string' ? route.query.return : '';
/** The trip the form was filled from to go back, said above the form. */
const returnFrom = ref('');
const fromBooking = ref(false);
const past = ref<PastOrder[]>([]);
const busy = ref(false);
const error = ref('');
const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
/** The dispatcher's own country code is the likeliest one for their passengers. */
function defaultCountry(): CountryCode {
  const own = session.user?.countryCode;
  return (COUNTRY_CODES as readonly string[]).includes(own ?? '') ? (own as CountryCode) : '+852';
}

/** A contact brought over from a booking or the 通訊錄 that is not a phone, shown so it can be retyped. */
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
  /** The driver price's currency: 人民幣 unless the dispatcher picks another. */
  currency: 'CNY',
  driverPrice: '',
  /** The passenger price's own currency: it follows the driver price's until the dispatcher picks another. */
  passengerCurrency: 'CNY',
  passengerPrice: '',
  showPassengerPrice: false,
  notes: '',
  passengerName: '',
  /** The passenger's phone: a country code and the number; passengers do not give a WeChat ID here. */
  passengerCountry: defaultCountry(),
  passengerPhone: '',
  contactRevealMinutes: 60 as number | null,
  /**
   * 直達 (false) or 接駁 (true): one order from 出發地 to 目的地 in two legs, each its own driver's,
   * changing cars at the 接駁位置. The time and driver price above are then the first leg's.
   */
  transfer: false,
  transferPlace: '',
  secondPickupAt: toLocalInput(new Date(inAnHour.getTime() + 60 * 60 * 1000)),
  secondCurrency: 'CNY',
  secondDriverPrice: '',
  /**
   * 往返 (true): one order in two legs, there and back; the time and driver price above are the way
   * there's, the second leg's fields hold the way back's. Never together with 接駁.
   */
  roundTrip: false,
  /** 往返: 同一位司機來回 (one claim takes both legs), or 可分開接. */
  sameDriver: true,
  /** 這單我自己做 (直達, or both legs of 同一位司機來回); with 接駁 or 可分開接 the dispatcher may drive one leg. */
  selfDrive: false,
  selfDriveLeg: null as 1 | 2 | null,
  /** 接單池: also list the order for every signed-in driver, not only the groups the link is pasted in. */
  inPool: false,
  /** 收款方式: show the dispatcher's ways to be paid on the passenger's confirmation page. */
  showPaymentMethods: false,
  /** 航班號: asked when the trip starts or ends at an airport. */
  flightNo: '',
  /** 往返: the way back's flight; the way there's is flightNo. */
  returnFlightNo: '',
  /** 往返: where the way back leaves from and goes to; the way there reversed until changed. */
  returnOrigin: '',
  returnDestination: '',
  /** 先給常用司機: the dispatcher's 常用司機 have the first 30 minutes. */
  favoritesFirst: false,
  /** 即時單: leaves now; no time to pick, the API takes the moment it is put out. */
  immediate: false,
});
/** 接駁 or 往返: two legs, the second's time and driver price asked too. */
const twoLegs = computed(() => form.transfer || form.roundTrip);
/** The dispatcher may drive one leg and offer the other: 接駁, and 往返 可分開接. */
const perLegSelf = computed(() => form.transfer || (form.roundTrip && !form.sameDriver));
/** Some leg goes to other drivers: not when the dispatcher drives the whole order themselves. */
const othersTake = computed(() => perLegSelf.value || !form.selfDrive);
/** A leg's name in the form: 去程／回程 for 往返, 第 N 段 for 接駁. */
const legName = (legIndex: 1 | 2) => (form.roundTrip ? (legIndex === 1 ? '去程' : '回程') : `第 ${legIndex} 段`);

/**
 * 直達, 往返 or 接駁; a leg the dispatcher chose to drive is cleared, as the legs change meaning.
 * 往返 starts with no time for the way back: any guess would go out to the group unnoticed, so the
 * dispatcher fills it in. 接駁 suggests the second leg an hour after the first.
 */
function setMode(mode: 'direct' | 'roundTrip' | 'transfer') {
  if (mode === 'roundTrip' && !form.roundTrip) form.secondPickupAt = '';
  if (mode === 'transfer' && !form.secondPickupAt) form.secondPickupAt = hourAfter(form.pickupAt || toLocalInput(inAnHour));
  form.transfer = mode === 'transfer';
  form.roundTrip = mode === 'roundTrip';
  form.selfDriveLeg = null;
}

/**
 * 往返: the way back follows the way there reversed while the dispatcher has not changed it (or it
 * is empty); once changed to another place it stays.
 */
watch(
  () => [form.origin, form.destination] as const,
  ([origin, destination], [beforeOrigin, beforeDestination]) => {
    if (!form.returnOrigin || form.returnOrigin === beforeDestination) form.returnOrigin = destination;
    if (!form.returnDestination || form.returnDestination === beforeOrigin) form.returnDestination = origin;
  },
);

/** An hour after a time in the form's local format. */
const hourAfter = (local: string) => toLocalInput(new Date(new Date(fromLocalInput(local)).getTime() + 60 * 60 * 1000));

/** 同一位司機來回 or 可分開接: who drives which leg is chosen again. */
function setSameDriver(same: boolean) {
  form.sameDriver = same;
  form.selfDriveLeg = null;
  form.selfDrive = false;
}

/** How many 常用司機 the dispatcher has marked; 先給常用司機 is offered only with some. */
const favoriteCount = ref(0);
/**
 * 先給常用司機 is offered with 常用司機, on an order others take, that leaves over an hour from now
 * (FAVORITES_FIRST_MIN_LEAD_MINUTES in shared/src/schemas.ts); never on 即時單.
 */
const favoritesOffered = computed(
  () =>
    favoriteCount.value > 0 &&
    othersTake.value &&
    !form.immediate &&
    Boolean(form.pickupAt) &&
    new Date(fromLocalInput(form.pickupAt)).getTime() - Date.now() > 60 * 60_000,
);
/** An airport at either end (or the 接駁位置): the flight number helps the driver at pickup. */
const airportTrip = computed(() =>
  [form.origin, form.destination, form.transfer ? form.transferPlace : '', ...(form.roundTrip ? [form.returnOrigin, form.returnDestination] : [])].some((place) =>
    /機場|机场|airport/i.test(place),
  ),
);
/** How many 收款方式 the dispatcher has set; with none there is nothing to show the passenger. */
const paymentMethodCount = ref<number | null>(null);

/** Places used before, most recent first: one tap fills them in. */
// A 接駁 order is listed by its first leg, which ends at the 接駁位置: its real end comes from the journey.
const places = computed(() =>
  [
    ...new Set(
      past.value.flatMap((order) => (order.journey ? [order.origin, order.destination, order.journey.destination] : [order.origin, order.destination])),
    ),
  ].slice(0, 6),
);
/** Four places at first; the rest behind 更多地點, so the row stays short. */
const allPlaces = ref(false);
const shownPlaces = computed(() => (allPlaces.value ? places.value : places.value.slice(0, 4)));

/**
 * 一句話出單: type the order the way it is written in the group; the form below
 * is filled in from it and stays fully editable. Nothing is sent until "出單".
 */
const line = ref('');
const filledFromLine = ref<string[]>([]);
/** Once the line filled the form, the box folds to one line saying what it filled. */
const lineFolded = ref(false);

function fillFromLine() {
  const parsed = parseQuickOrder(line.value);
  const filled: string[] = [];
  form.immediate = Boolean(parsed.immediate);
  if (parsed.immediate) {
    filled.push('即時（現在出發）');
  } else if (parsed.pickupAt) {
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
  // 往返 in the line: the form opens on it, the way back's time left to fill.
  if (parsed.roundTrip) {
    setMode('roundTrip');
    filled.push('類型 往返');
  }
  filledFromLine.value = filled;
  lineFolded.value = filled.length > 0;
}

/** Set once the passenger price's currency was picked, or came with the order being copied or the booking. */
const passengerCurrencyChosen = ref(false);
watch(
  () => form.currency,
  (currency) => {
    if (!passengerCurrencyChosen.value) form.passengerCurrency = currency;
  },
);

/** The spread, only when every price is in the same currency (the API counts it the same way). */
const margin = computed(() => {
  if (!form.passengerPrice) return null;
  // 接駁 and 往返: the passenger's one price against what both legs' drivers are paid; a leg the
  // dispatcher drives pays nobody.
  const self = (legIndex: 1 | 2) => (perLegSelf.value ? form.selfDriveLeg === legIndex : form.selfDrive);
  const paid = twoLegs.value
    ? [
        { price: form.driverPrice, currency: form.currency, self: self(1) },
        { price: form.secondDriverPrice, currency: form.secondCurrency, self: self(2) },
      ].filter((leg) => !leg.self)
    : [{ price: form.driverPrice, currency: form.currency }];
  if (paid.some((leg) => !leg.price || leg.currency !== form.passengerCurrency)) return null;
  return Number(form.passengerPrice) - paid.reduce((sum, leg) => sum + Number(leg.price), 0);
});

/**
 * 即時 switched on or off answers a message about the time; it should not stay on screen.
 * 即時單 goes into the 接單池 by default (the dispatcher can still switch that off); switched
 * off again, the 接單池 choice goes back to what it was.
 */
let poolBeforeImmediate = false;
watch(
  () => form.immediate,
  (on) => {
    error.value = '';
    if (on) {
      poolBeforeImmediate = form.inPool;
      form.inPool = true;
    } else {
      form.inPool = poolBeforeImmediate;
    }
  },
);

/**
 * 接駁: the second leg never starts before the first; moved along when it would. 往返's way back is
 * the dispatcher's own choice: it is never moved, and an earlier one is flagged instead.
 */
watch(
  () => form.pickupAt,
  (first) => {
    if (form.transfer && first && form.secondPickupAt < first) form.secondPickupAt = hourAfter(first);
  },
);

/** Repeats the last order's route and prices; the time and passenger are left for this trip. */
function copyLast() {
  const last = past.value[0];
  if (!last) return;
  Object.assign(form, {
    origin: last.origin,
    destination: last.journey?.destination ?? last.destination,
    waypoints: [...last.waypoints],
    passengers: String(last.passengers),
    luggage: String(last.luggage),
    vehicleType: last.vehicleType ?? '',
    notes: last.notes ?? '',
    currency: last.driverPrice?.currency ?? 'CNY',
    driverPrice: last.driverPrice ? String(last.driverPrice.amount) : '',
    passengerCurrency: last.passengerPrice?.currency ?? last.driverPrice?.currency ?? 'CNY',
    passengerPrice: last.passengerPrice ? String(last.passengerPrice.amount) : '',
    showPassengerPrice: last.showPassengerPrice ?? false,
  });
  passengerCurrencyChosen.value = Boolean(last.passengerPrice);
}

/** Fills the first empty place in route order: 出發地, then 接駁位置 (with 接駁), then 目的地. */
function fillPlace(place: string) {
  if (!form.origin) form.origin = place;
  else if (form.transfer && !form.transferPlace) form.transferPlace = place;
  else if (!form.destination) form.destination = place;
}

const price = (value: string, currency: string) => (value ? { amount: Number(value), currency } : undefined);

/** The message sits at the top of the form while 出單 is at the bottom: bring it into sight. */
async function showError(message: string) {
  error.value = message;
  await nextTick();
  // Not smooth: tapping 出單 cancels a smooth scroll in some browsers.
  document.getElementById('new-order-error')?.scrollIntoView({ block: 'center' });
}

async function submit() {
  error.value = '';
  // Checked here first so the driver hears about a wrong number before anything is sent; the API checks it again.
  if (!isValidPassengerPhone(form.passengerCountry, form.passengerPhone)) {
    error.value = t(form.passengerCountry === '+86' ? '乘客電話請填 11 位內地手機號碼' : '乘客電話請填 8 位數字');
    document.getElementById('passenger-phone')?.focus();
    return;
  }
  if (!form.immediate && new Date(fromLocalInput(form.pickupAt)).getTime() < Date.now() - 60_000) {
    void showError(t('出發時間已經過了；現在就要出發，請打開「即時（現在出發）」'));
    return;
  }
  // 即時單 leaves now: the API takes the moment it is put out; this is only for the check below.
  const firstAt = form.immediate ? toLocalInput(new Date()) : form.pickupAt;
  if (form.roundTrip && !form.secondPickupAt) {
    void showError(t('往返請填回程時間'));
    return;
  }
  if (twoLegs.value && form.secondPickupAt < firstAt) {
    void showError(t(form.roundTrip ? '回程的時間不能早於去程' : '第 2 段的時間不能早於第 1 段'));
    return;
  }
  busy.value = true;
  try {
    const created = await api<{ id: string }>('POST', '/orders', {
      pickupAt: fromLocalInput(firstAt),
      immediate: form.immediate,
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
      bookingId: fromBooking.value ? bookingId : undefined,
      transfer: form.transfer
        ? {
            place: form.transferPlace,
            pickupAt: fromLocalInput(form.secondPickupAt),
            driverPrice: price(form.secondDriverPrice, form.secondCurrency),
            selfDriveLeg: form.selfDriveLeg,
          }
        : undefined,
      roundTrip: form.roundTrip
        ? {
            pickupAt: fromLocalInput(form.secondPickupAt),
            driverPrice: price(form.secondDriverPrice, form.secondCurrency),
            flightNo: airportTrip.value && form.returnFlightNo.trim() ? form.returnFlightNo.trim() : undefined,
            origin: form.returnOrigin.trim() || undefined,
            destination: form.returnDestination.trim() || undefined,
            sameDriver: form.sameDriver,
            selfDriveLeg: form.sameDriver ? null : form.selfDriveLeg,
          }
        : undefined,
      selfDrive: !perLegSelf.value && form.selfDrive,
      inPool: othersTake.value && form.inPool,
      showPaymentMethods: form.showPaymentMethods,
      flightNo: airportTrip.value && form.flightNo.trim() ? form.flightNo.trim() : undefined,
      favoritesFirst: favoritesOffered.value && form.favoritesFirst,
    });
    // Straight to the texts to paste: getting the order into the groups is the point of dispatching.
    await router.replace(`/app/orders/${created.id}/share`);
  } catch (e) {
    void showError(errorText(e));
  } finally {
    busy.value = false;
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
      transfer: boolean;
      roundTrip: boolean;
      returnPickupAt: string | null;
      returnOrigin: string | null;
      returnDestination: string | null;
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
      // The passenger asked for 接駁: the form opens on it, the 接駁位置 left for the driver.
      transfer: booking.transfer,
      // Or for 往返, with the time to be picked up for the way back.
      roundTrip: booking.roundTrip,
      ...(booking.roundTrip
        ? {
            secondPickupAt: booking.returnPickupAt ? toLocalInput(new Date(booking.returnPickupAt)) : '',
            // The passenger may come back from or to somewhere else; else the way there reversed.
            returnOrigin: booking.returnOrigin ?? booking.destination,
            returnDestination: booking.returnDestination ?? booking.origin,
          }
        : {}),
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

/** What the folded 乘客價、備註與更多 currently says, so nothing is hidden by surprise. */
const moreSummary = computed(() =>
  [
    form.passengerPrice ? `乘客價 ${form.passengerPrice}` : '',
    form.notes.trim() ? '有備註' : '',
    `乘客電話${revealLabel(form.contactRevealMinutes)}`,
    perLegSelf.value && form.selfDriveLeg ? `${legName(form.selfDriveLeg)}我自己做` : '',
    !perLegSelf.value && form.selfDrive ? (form.roundTrip ? '來回我自己做' : '這單我自己做') : form.inPool ? '放進接單池' : '只給拿到連結的人',
    form.favoritesFirst && favoritesOffered.value ? '先給常用司機' : '',
  ]
    .filter(Boolean)
    .join(' · '),
);

/**
 * 出回程單: the trip back from an earlier order. The route is turned around (a 接駁 order's legs too,
 * each keeping its driver price), the load, passenger and prices stay; the time is left to fill.
 */
async function loadReturn() {
  try {
    const from = await api<{
      origin: string;
      destination: string;
      passengers: number;
      luggage: number;
      vehicleType: string | null;
      notes: string | null;
      passengerName: string | null;
      passengerContact: string | null;
      driverPrice: { amount: number; currency: string } | null;
      passengerPrice: { amount: number; currency: string } | null;
      showPassengerPrice: boolean;
      journey: {
        kind: 'TRANSFER' | 'ROUND_TRIP';
        origin: string;
        destination: string;
        transferPlaces: string[];
        legs: { driverPrice: { amount: number; currency: string } | null }[];
      } | null;
    }>('GET', `/orders/${returnOf}`);
    const legs = from.journey?.legs ?? [];
    // A 往返 already comes back; 出回程單 is not offered on one, and from one it is a single trip back.
    const back = from.journey && from.journey.kind !== 'ROUND_TRIP' && legs.length > 1 ? { first: legs[legs.length - 1].driverPrice, second: legs[0].driverPrice } : null;
    Object.assign(form, {
      pickupAt: '',
      origin: from.journey?.destination ?? from.destination,
      destination: from.journey?.origin ?? from.origin,
      transfer: Boolean(back),
      transferPlace: back ? (from.journey!.transferPlaces[0] ?? '') : '',
      secondPickupAt: '',
      passengers: String(from.passengers),
      luggage: String(from.luggage),
      vehicleType: from.vehicleType ?? '',
      notes: from.notes ?? '',
      currency: (back ? back.first : from.driverPrice)?.currency ?? 'CNY',
      driverPrice: (back ? back.first : from.driverPrice) ? String((back ? back.first : from.driverPrice)!.amount) : '',
      secondCurrency: back?.second?.currency ?? 'CNY',
      secondDriverPrice: back?.second ? String(back.second.amount) : '',
      passengerCurrency: from.passengerPrice?.currency ?? from.driverPrice?.currency ?? 'CNY',
      passengerPrice: from.passengerPrice ? String(from.passengerPrice.amount) : '',
      showPassengerPrice: from.showPassengerPrice,
      passengerName: from.passengerName ?? '',
    });
    passengerCurrencyChosen.value = Boolean(from.passengerPrice);
    carryContact(from.passengerContact);
    returnFrom.value = `${from.journey?.origin ?? from.origin} 至 ${from.journey?.destination ?? from.destination}`;
  } catch (e) {
    error.value = errorText(e);
  }
}

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

/** With ?paste=1 (once a button on 首頁): start with the cursor in the one-line box, ready to paste. */
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
  void api<{ favorite: boolean }[]>('GET', '/me/drivers')
    .then((drivers) => (favoriteCount.value = drivers.filter((driver) => driver.favorite).length))
    .catch(() => (favoriteCount.value = 0));
  if (preferences) {
    form.contactRevealMinutes = preferences.contactRevealMinutes;
    if (form.immediate) poolBeforeImmediate = preferences.poolByDefault;
    else form.inPool = preferences.poolByDefault;
  }
  if (bookingId) await loadBooking();
  else if (returnOf) await loadReturn();
  else if (pickedPassenger.value) usePassenger(pickedPassenger.value);
  pickedPassenger.value = null;
});
</script>

<template>
  <form class="page new-order" @submit.prevent="submit">
    <PageBack :title="t('出單')" :fallback="bookingId ? `/app/bookings/${bookingId}` : '/app'" history>
      <button v-if="past.length" class="chip new-order__copy" type="button" @click="copyLast">{{ t('複製上一張') }}</button>
    </PageBack>
    <div v-if="error" id="new-order-error" class="notice error">{{ error }}</div>

    <div v-if="fromBooking && form.transfer" class="notice">
      {{ t('已帶入客人詢價的資料，乘客要接駁（中途換車）。填接駁位置和每段的出單價後出單。') }}
    </div>
    <div v-else-if="fromBooking && form.roundTrip" class="notice">
      {{ t('已帶入客人詢價的資料，乘客要往返，回程時間也已帶入。選同一位司機來回或可分開接，填去程和回程的出單價後出單。') }}
    </div>
    <div v-else-if="fromBooking" class="notice">
      {{ form.passengerPrice ? t('已帶入客人詢價的資料和你的報價（作為乘客價）。填出單價後出單，貼到群裡派給其他司機。') : t('已帶入客人詢價的資料。填出單價後出單，貼到群裡派給其他司機。') }}
    </div>

    <div v-if="returnFrom" class="notice">{{ t(`回程：已帶入「${returnFrom}」的路線（對調）、人數、乘客和價錢。填回程的時間後出單。`) }}</div>

    <!-- 一句話出單: written like a message in the group, so it looks like one. Once it filled the form it folds to one line. -->
    <div v-if="!fromBooking && !returnFrom && lineFolded" class="quick-line quick-line--folded">
      <span class="hint">{{ t(`已填入：${filledFromLine.join('、')}。請核對下面。`) }}</span>
      <button class="chip" type="button" @click="lineFolded = false">{{ t('重新貼上') }}</button>
    </div>
    <div v-else-if="!fromBooking && !returnFrom" class="quick-line">
      <textarea
        ref="lineInput"
        v-model="line"
        class="quick-line__input"
        maxlength="300"
        :aria-label="t('一句話出單')"
        :placeholder="t('照群裡的寫法貼上一句，例如：明天15:40澳門送香港 直車 7座')"
      />
      <div class="quick-line__foot">
        <span class="hint">{{ t('一句話出單，自動填好下面') }}</span>
        <button class="button quick-line__fill" type="button" :disabled="!line.trim()" @click="fillFromLine">{{ t('自動填入') }}</button>
      </div>
    </div>

    <!-- The trip: when, from where to where, and the flight when an airport is at either end. -->
    <section class="card">
      <div class="segment segment--block new-order__mode" role="group" :aria-label="t('直達、往返或接駁')">
        <button type="button" :aria-pressed="!twoLegs" @click="setMode('direct')">{{ t('直達') }}</button>
        <button type="button" :aria-pressed="form.roundTrip" @click="setMode('roundTrip')">{{ t('往返') }}</button>
        <button type="button" :aria-pressed="form.transfer" @click="setMode('transfer')">{{ t('接駁') }}</button>
      </div>
      <p v-if="form.transfer" class="hint new-order__explain">
        {{ t('中途換車：一張單分兩段，在接駁位置換車，各由一位司機接。群裡貼一條訊息，司機選段搶；乘客只看到一個價格。乘客自行過關不算接駁。') }}
      </p>
      <template v-if="form.roundTrip">
        <p class="hint new-order__explain">
          {{ t('一張單兩程：回程預設原路回來，地點不同可以改。群裡貼一條訊息，乘客只看到一個價格。') }}
        </p>
        <div class="segment segment--block new-order__mode new-order__drivers" role="group" :aria-label="t('誰開回程')">
          <button type="button" :aria-pressed="form.sameDriver" @click="setSameDriver(true)">{{ t('同一位司機來回') }}</button>
          <button type="button" :aria-pressed="!form.sameDriver" @click="setSameDriver(false)">{{ t('可分開接') }}</button>
        </div>
        <p class="hint new-order__explain">
          {{ form.sameDriver ? t('司機一搶就是去程和回程。') : t('司機選一程搶，同一位司機也可以兩程都搶。') }}
        </p>
      </template>

      <label class="new-order__switch new-order__now">
        <span>
          {{ twoLegs ? t(`${legName(1)}即時（現在出發）`) : t('即時（現在出發）') }}
          <small>{{ form.immediate ? t('放進接單池，10 分鐘沒人接會提醒你') : t('馬上要車就打開') }}</small>
        </span>
        <input v-model="form.immediate" class="switch" type="checkbox" />
      </label>
      <label v-if="!form.immediate" class="line-field">
        <span>{{ twoLegs ? t(`${legName(1)}出發時間（香港時間）`) : t('出發時間（香港時間）') }}</span>
        <input v-model="form.pickupAt" class="line-input new-order__time" type="datetime-local" required />
      </label>

      <!-- The route as dots on a line, the way the claim page shows it. -->
      <ol class="route-inputs">
        <li class="route-inputs__stop route-inputs__stop--origin">
          <input
            v-model="form.origin"
            class="line-input"
            maxlength="120"
            :aria-label="t('出發地')"
            :placeholder="t('從哪裡出發，例如：深圳灣口岸')"
            required
          />
        </li>
        <li v-for="(_, index) in form.waypoints" :key="index" class="route-inputs__stop route-inputs__stop--via">
          <div class="new-order__via">
            <input v-model="form.waypoints[index]" class="line-input" maxlength="120" :aria-label="t(`途經點 ${index + 1}`)" :placeholder="t('途經')" />
            <button class="new-order__remove" type="button" :aria-label="t(`刪除途經點 ${index + 1}`)" @click="form.waypoints.splice(index, 1)">
              <AppIcon name="close" :size="18" />
            </button>
          </div>
        </li>
        <!-- 接駁: where the first leg ends and the second begins, set by the dispatcher. -->
        <li v-if="form.transfer" class="route-inputs__stop route-inputs__stop--transfer">
          <input v-model="form.transferPlace" class="line-input" maxlength="120" :aria-label="t('接駁位置')" :placeholder="t('接駁位置（在哪裡換車），例如：深圳灣口岸')" required />
        </li>
        <li class="route-inputs__stop route-inputs__stop--destination">
          <input
            v-model="form.destination"
            class="line-input"
            maxlength="120"
            :aria-label="t('目的地')"
            :placeholder="form.transfer ? t('最後去哪裡，例如：廣州') : t('去哪裡，例如：香港國際機場')"
            required
          />
        </li>
      </ol>
      <label v-if="twoLegs" class="line-field new-order__second-time">
        <span>{{ form.roundTrip ? t('回程出發時間（香港時間）') : t('第 2 段出發時間（在接駁位置換車）') }}</span>
        <input v-model="form.secondPickupAt" class="line-input new-order__time" type="datetime-local" :min="form.immediate ? undefined : form.pickupAt" required />
      </label>
      <!-- 往返: the way back, the way there reversed until the dispatcher names other places. -->
      <template v-if="form.roundTrip">
        <span class="section-label new-order__return-label">{{ t('回程路線（預設原路，可改）') }}</span>
        <ol class="route-inputs new-order__return-route">
          <li class="route-inputs__stop route-inputs__stop--origin">
            <input v-model="form.returnOrigin" class="line-input" maxlength="120" :aria-label="t('回程上車地點')" :placeholder="t('回程從哪裡上車')" required />
          </li>
          <li class="route-inputs__stop route-inputs__stop--destination">
            <input v-model="form.returnDestination" class="line-input" maxlength="120" :aria-label="t('回程目的地')" :placeholder="t('回程去哪裡')" required />
          </li>
        </ol>
      </template>
      <p
        v-if="twoLegs && form.secondPickupAt && (form.immediate ? form.secondPickupAt < toLocalInput(new Date()) : form.pickupAt && form.secondPickupAt < form.pickupAt)"
        class="hint new-order__time-error"
      >
        {{ form.roundTrip ? t('回程的時間不能早於去程') : t('第 2 段的時間不能早於第 1 段') }}
      </p>
      <div class="chips new-order__places">
        <button v-if="form.waypoints.length < 5" class="chip" type="button" @click="form.waypoints.push('')">{{ t('加途經點') }}</button>
        <button v-for="place in shownPlaces" :key="place" class="chip" type="button" @click="fillPlace(place)">{{ t(place) }}</button>
        <button v-if="places.length > 4 && !allPlaces" class="chip" type="button" @click="allPlaces = true">{{ t('更多地點') }}</button>
      </div>
      <label v-if="airportTrip" class="line-field new-order__flight">
        <span>{{ form.roundTrip ? t('去程航班號（選填）') : t('航班號（選填）') }}</span>
        <input v-model.trim="form.flightNo" class="line-input" maxlength="20" autocapitalize="characters" :placeholder="t('例如：CX123')" />
      </label>
      <!-- 往返: the way back is another flight (the way there lands, the way back takes off). -->
      <label v-if="airportTrip && form.roundTrip" class="line-field new-order__flight">
        <span>{{ t('回程航班號（選填）') }}</span>
        <input v-model.trim="form.returnFlightNo" class="line-input" maxlength="20" autocapitalize="characters" :placeholder="t('例如：CX124')" />
      </label>
    </section>

    <!-- The car and what the driver is paid: what a driver reads first in the group. -->
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
          <input v-model.trim="form.vehicleType" class="line-input" maxlength="30" :placeholder="t('7座')" required />
        </label>
      </div>
      <span class="section-label new-order__driver-price">
        {{
          form.transfer
            ? t('出單價，每段給接那一段的司機')
            : form.roundTrip
              ? form.sameDriver
                ? t('出單價，去程和回程分開寫，司機兩程都拿')
                : t('出單價，每程給接那一程的司機')
              : t('出單價，拿到連結的司機看得到')
        }}
      </span>
      <div class="amount-line">
        <span v-if="twoLegs" class="new-order__leg-label">{{ t(legName(1)) }}</span>
        <select v-model="form.currency" :aria-label="twoLegs ? t(`${legName(1)}幣種`) : t('幣種')">
          <option value="CNY">RMB¥</option>
          <option value="HKD">HK$</option>
          <option value="MOP">MOP$</option>
        </select>
        <input
          v-model="form.driverPrice"
          type="number"
          min="0"
          step="0.01"
          inputmode="decimal"
          :aria-label="twoLegs ? t(`${legName(1)}出單價`) : t('出單價')"
          :placeholder="t('出單價')"
        />
      </div>
      <div v-if="twoLegs" class="amount-line new-order__second-price">
        <span class="new-order__leg-label">{{ t(legName(2)) }}</span>
        <select v-model="form.secondCurrency" :aria-label="t(`${legName(2)}幣種`)">
          <option value="CNY">RMB¥</option>
          <option value="HKD">HK$</option>
          <option value="MOP">MOP$</option>
        </select>
        <input v-model="form.secondDriverPrice" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t(`${legName(2)}出單價`)" :placeholder="t('出單價')" />
      </div>
    </section>

    <section class="card">
      <div class="new-order__passenger-head">
        <span class="section-label">{{ t('乘客') }}</span>
        <button v-if="past.length" class="new-order__book" type="button" @click="openBook">{{ t('從通訊錄選') }}</button>
      </div>
      <input v-model.trim="form.passengerName" class="line-input new-order__name" maxlength="40" :aria-label="t('乘客稱呼')" :placeholder="t('稱呼，例如：王小姐')" :required="!fromBooking" />
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

    <!-- Everything most orders leave as it is, folded with a line saying what it holds, so the form shows only what must be filled. -->
    <details class="card new-order__more" :open="fromBooking || form.selfDrive || form.selfDriveLeg !== null || undefined">
      <summary>
        <span class="new-order__more-text">
          <strong>{{ t('乘客價、備註與更多') }}</strong>
          <span class="hint">{{ t(moreSummary) }}</span>
        </span>
        <AppIcon name="chevron" class="new-order__more-arrow" />
      </summary>

      <label class="line-field">
        <span>{{ t('備註') }}</span>
        <textarea v-model="form.notes" class="line-input" maxlength="500" :placeholder="t('例如：需要兒童座椅')" />
      </label>

      <span class="section-label new-order__passenger-price">{{ twoLegs ? t('乘客價（整趟一個價），只有你看得到') : t('乘客價，只有你看得到') }}</span>
      <div class="amount-line amount-line--quiet">
        <select v-model="form.passengerCurrency" :aria-label="t('乘客價幣種')" @change="passengerCurrencyChosen = true">
          <option value="CNY">RMB¥</option>
          <option value="HKD">HK$</option>
          <option value="MOP">MOP$</option>
        </select>
        <input v-model="form.passengerPrice" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('乘客價')" :placeholder="t('乘客價（選填）')" />
      </div>
      <p v-if="margin !== null" class="new-order__margin">{{ t(`差價 ${margin}`) }}</p>
      <p v-else-if="form.driverPrice && form.passengerPrice" class="hint new-order__margin-none">{{ t('兩個價格幣種不同，不計差價。') }}</p>
      <!-- Only once there is a price to show, or a way to be paid. -->
      <label v-if="form.passengerPrice" class="new-order__switch">
        <span>{{ t('乘客確認頁顯示乘客價') }}</span>
        <input v-model="form.showPassengerPrice" class="switch" type="checkbox" />
      </label>
      <label v-if="paymentMethodCount" class="new-order__switch">
        <span>
          {{ t('乘客確認頁顯示收款方式') }}
          <small>{{ t('乘客直接付給你，顯示時會一併顯示乘客價') }}</small>
        </span>
        <input v-model="form.showPaymentMethods" class="switch" type="checkbox" />
      </label>
      <p v-else-if="paymentMethodCount === 0" class="hint new-order__pay-link">
        <RouterLink to="/app/payment-methods">{{ t('設定收款方式') }}</RouterLink>{{ t('，乘客可以直接付給你') }}
      </p>

      <label class="new-order__switch new-order__divided">
        <span>
          {{ t('乘客電話給接單司機看') }}
          <small>{{ t('在這之前，司機只能聯絡你；行程完成或取消後，司機就看不到乘客電話') }}</small>
        </span>
        <RevealSelect v-model="form.contactRevealMinutes" class="select--inline" />
      </label>
      <!-- 接駁 and 往返 可分開接: the dispatcher may drive one of the two legs; the other always goes to the group. -->
      <div v-if="perLegSelf" class="line-field new-order__self-leg">
        <span>
          {{ form.roundTrip ? t('自己做其中一程') : t('自己做其中一段') }}
          <small class="hint">{{ session.profile ? (form.roundTrip ? t('那一程直接算你接，另一程貼到群裡搶') : t('那一段直接算你接，另一段貼到群裡搶')) : t('請先在「我的」填寫司機資料') }}</small>
        </span>
        <div class="segment" role="group" :aria-label="form.roundTrip ? t('自己做其中一程') : t('自己做其中一段')">
          <button type="button" :aria-pressed="form.selfDriveLeg === null" @click="form.selfDriveLeg = null">{{ t('都給別人') }}</button>
          <button type="button" :aria-pressed="form.selfDriveLeg === 1" @click="form.selfDriveLeg = 1">{{ t(legName(1)) }}</button>
          <button type="button" :aria-pressed="form.selfDriveLeg === 2" @click="form.selfDriveLeg = 2">{{ t(legName(2)) }}</button>
        </div>
      </div>
      <label v-if="!perLegSelf" class="new-order__switch">
        <span>
          {{ form.roundTrip ? t('這單我自己做（來回）') : t('這單我自己做') }}
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
      <label v-if="othersTake" class="new-order__switch">
        <span>
          {{ t('同時放到接單池') }}
          <small>{{ t('登入的司機都看得到並可以搶，乘客資料仍只給搶到的司機') }}</small>
        </span>
        <input v-model="form.inPool" class="switch" type="checkbox" />
      </label>
      <label v-if="favoritesOffered" class="new-order__switch">
        <span>
          {{ t('先給常用司機 30 分鐘') }}
          <small>{{ t(`你的 ${favoriteCount} 位常用司機先搶，30 分鐘後所有人都可以搶`) }}</small>
        </span>
        <input v-model="form.favoritesFirst" class="switch" type="checkbox" />
      </label>
    </details>

    <div class="action-bar">
      <button class="button block large" type="submit" :disabled="busy">{{ t('出單') }}</button>
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
  font-size: 17px;
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
.quick-line--folded {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-bottom: var(--space-md);
}
.quick-line--folded .chip {
  flex-shrink: 0;
  white-space: nowrap;
}
.new-order__flight {
  margin-top: var(--space-md);
}
.new-order__driver-price {
  display: block;
  margin-top: var(--space-lg);
}
.new-order__pay-link {
  margin: var(--space-sm) 0 0;
}
.new-order__divided {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-divider);
}
.new-order__second-time {
  margin-top: var(--space-md);
}
.new-order__return-label {
  display: block;
  margin-top: var(--space-md);
}
.new-order__return-route {
  margin-top: var(--space-xs);
}
.new-order__leg-label {
  flex: none;
  align-self: center;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.new-order__second-price {
  margin-top: var(--space-sm);
}
.new-order__self-leg {
  margin-bottom: var(--space-md);
}
.new-order__self-leg small {
  display: block;
}
.new-order__explain {
  margin: calc(var(--space-sm) * -1) 0 var(--space-lg);
}
.new-order__time {
  font-variant-numeric: tabular-nums;
}
.new-order__time-error {
  margin: calc(var(--space-md) * -1) 0 var(--space-lg);
  color: var(--color-error);
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
.new-order__now {
  margin-bottom: var(--space-sm);
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
  font-size: 20px;
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
