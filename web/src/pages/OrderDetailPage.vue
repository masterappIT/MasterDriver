<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import BottomSheet from '../components/BottomSheet.vue';
import ContactLines from '../components/ContactLines.vue';
import JourneyLegs from '../components/JourneyLegs.vue';
import CarpoolParties, { type CarpoolOnOrder } from '../components/CarpoolParties.vue';
import OrderMoneyMarks from '../components/OrderMoneyMarks.vue';
import PlateTag from '../components/PlateTag.vue';
import RevealSelect, { revealLabel } from '../components/RevealSelect.vue';
import RoutePoints from '../components/RoutePoints.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TripGroupJoin, { type TripGroup } from '../components/TripGroupJoin.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import { imageForUpload } from '../image';
import { fromLocalInput, loadLine, money, pickup, plateKind, shortTime, toLocalInput, type Money } from '../format';
import PageBack from '../components/PageBack.vue';
import AppIcon from '../components/AppIcon.vue';
import GroupText from '../components/GroupText.vue';
import { t } from '../i18n';
import { PROGRESS_STEPS, legLabel, legName, plateRequirement, progressLine, type Journey, type PlateRegion, type TripProgress } from '../journey';
import { charterHours } from '@masterdriver/shared/charter';
import CharterRules from '../components/CharterRules.vue';
import type { OrderCharter } from '../charter';
import { toast } from '../toast';
import type { PlateType } from '@masterdriver/shared/vehicle-plate';

interface Driver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  plateType?: PlateType | null;
  vehicleType: string | null;
  color: string | null;
  phone: string;
  /** Every number of the driver; the first is `phone`. */
  phones?: string[];
  /** The driver keeps their plates from passengers. */
  hidePlates?: boolean;
  /** From the driver's 名片頁. */
  wechatId?: string | null;
  whatsapp?: string | null;
}

interface Detail {
  id: string;
  code: string;
  status: string;
  cancelledAt: string | null;
  completedAt: string | null;
  pickupAt: string;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  notes: string | null;
  /** 航班號 of an airport pickup or drop-off. */
  flightNo: string | null;
  /** 即時單: pickupAt is when it was put out to leave now. */
  immediate?: boolean;
  requiredPlates: PlateRegion[];
  journey: Journey | null;
  /** 包車 (按小時計費): its hours, prices an hour and rules; null for any other order. */
  charter?: OrderCharter | null;
  /** 拼車: the order's parties of passengers, each with its own progress (and, for the dispatcher, fare). */
  carpool?: CarpoolOnOrder | null;
  /** 行程進度 the driver reported. */
  progress?: TripProgress;
  /** 修改行程 the driver has not confirmed yet: what changed and when. */
  change?: { summary: string; at: string } | null;
  dispatcherName: string | null;
  dispatcherPhone?: string;
  /** The dispatcher's 名片頁, when it is public. */
  dispatcherPageCode?: string | null;
  dispatcherContact?: { wechatId: string | null; whatsapp: string | null; phones?: string[] };
  claimedAt: string | null;
  passengerConfirmedAt: string | null;
  /** 出單者代確認: the dispatcher confirmed for the passenger. */
  passengerConfirmedByDispatcher?: boolean;
  viewer: 'dispatcher' | 'driver';
  passengerName: string | null;
  passengerContact: string | null;
  contactRevealAt: string | null;
  /** For the driver: the trip is over, so the passenger's phone is no longer shown. */
  contactEnded?: boolean;
  /** 行程群: the dispatcher's own group for this trip (passenger, dispatcher, driver). */
  tripGroup?: TripGroup | null;
  contactRevealMinutes?: number | null;
  selfDrive?: boolean;
  /** 司機已刪除 (dispatcher only): the driver who took it was deleted by the platform since. */
  driverDeleted?: boolean;
  /** 接單池: listed for every signed-in driver (dispatcher only). */
  inPool?: boolean;
  driver: Driver | null;
  driverPrice: Money;
  passengerPrice?: Money;
  showPassengerPrice?: boolean;
  margin?: Money;
  serviceFee?: number | null;
  /** 收款 (dispatcher only): the passenger's page shows the ways to pay, and when the fare was marked received. */
  showPaymentMethods?: boolean;
  paidAt?: string | null;
  /** 已結清: the dispatcher's mark that the account with the driver is settled; both see it. */
  settledAt?: string | null;
  links?: { dispatch: string; passengerConfirm: string };
  /** Made from a passenger's booking request: their booking link already leads to the confirmation page. */
  fromBooking?: boolean;
  share?: { dispatch: { wechat: string; whatsapp: string }; claimed: string | null; passenger: string };
}

const route = useRoute();
const router = useRouter();
// Legs of one trip link to each other on this same page, so follow the route.
const id = computed(() => String(route.params.id));
const order = ref<Detail | null>(null);
const error = ref('');
const busy = ref(false);
const editingPrices = ref(false);
const prices = reactive({ currency: 'HKD', driver: '', passengerCurrency: 'HKD', passenger: '' });

const isDispatcher = computed(() => order.value?.viewer === 'dispatcher');
const live = computed(() => order.value?.status === 'OPEN' || order.value?.status === 'ASSIGNED');
const selfDriven = computed(() => Boolean(order.value?.selfDrive) && order.value?.status === 'ASSIGNED');
/**
 * 這單我自己做: the dispatcher drives it, so the page keeps what driving needs (trip, passenger,
 * price and payment, 標記完成); the settings fold into 其他設定 and the dispatching parts go.
 */
// 接駁 with 這段我自己做 still has another driver on the other leg, so it keeps the full view; a
// 往返 whose legs the dispatcher drives both is theirs alone.
const ownTrip = computed(
  () => isDispatcher.value && Boolean(order.value?.selfDrive) && (!order.value?.journey || order.value.journey.legs.every((leg) => leg.selfDrive)),
);
/** 往返: there and back, legs named 去程／回程, no 接駁位置. */
const roundTrip = computed(() => order.value?.journey?.kind === 'ROUND_TRIP');
/** 往返 同一位司機來回: the driver holds both legs, and 改派 or 取消接單 moves both. */
const together = computed(() => roundTrip.value && Boolean(order.value?.journey?.sameDriver));
/** What the whole order is called: 往返單 or 接駁單. */
const tripWord = computed(() => (roundTrip.value ? '往返單' : '接駁單'));
/**
 * A cancelled order seen by the driver who had it: only that it is off, which trip it was, and
 * whom to ask. The passenger, the prices, their own car and the other leg are no longer theirs.
 */
const cancelledForDriver = computed(() => !isDispatcher.value && order.value?.status === 'CANCELLED');
/**
 * A finished trip seen by its driver: what is left is the money (the driver price and whether the
 * dispatcher marked it settled) and whom to settle with.
 */
const doneForDriver = computed(() => !isDispatcher.value && order.value?.status === 'COMPLETED');
/** Over, either way: the driver keeps only the trip and the dispatcher's name and call button. */
const endedForDriver = computed(() => cancelledForDriver.value || doneForDriver.value);
/** 接駁: the passenger's one price for the whole order is kept on, and changed from, the first leg. */
const tripPriceHere = computed(() => !order.value?.carpool && (!order.value?.journey || order.value.journey.legIndex === 1));
/** A driver is set and the passenger has not confirmed: remind the dispatcher to send the link. */
/** Someone else has the order: the group now needs 已派出, not the order again. */
const taken = computed(() => order.value?.status === 'ASSIGNED' && !selfDriven.value && Boolean(order.value.share?.claimed));
// 拼車: each party has its own link already, and confirmed their seats there.
const remindPassenger = computed(
  () => isDispatcher.value && order.value?.status === 'ASSIGNED' && !order.value.passengerConfirmedAt && !order.value.fromBooking && !order.value.carpool,
);

/** 出單者代確認: the passenger said yes by phone or message but did not press the link. Not for 拼車. */
const canConfirmForPassenger = computed(
  () =>
    isDispatcher.value &&
    (order.value?.status === 'OPEN' || order.value?.status === 'ASSIGNED') &&
    !order.value.passengerConfirmedAt &&
    !order.value.carpool,
);
/** Who confirmed, said to whoever is reading. */
const confirmedText = computed(() => {
  const o = order.value;
  if (!o?.passengerConfirmedAt) return '乘客還沒確認';
  const at = shortTime(o.passengerConfirmedAt);
  if (!o.passengerConfirmedByDispatcher) return `乘客 ${at} 確認了行程`;
  return isDispatcher.value ? `你 ${at} 代乘客確認了行程` : `出單者 ${at} 代乘客確認了行程`;
});

/** 接駁 is cancelled whole; one leg's driver is replaced with 改派 instead. */
const cancelQuestion = computed(() =>
  roundTrip.value
    ? together.value
      ? '確定取消整張往返單？去程和回程都會取消。只想換司機，請用「改派」。'
      : '確定取消整張往返單？去程和回程都會取消。只想換其中一程的司機，請用「改派」。'
    : order.value?.journey
      ? '確定取消整張接駁單？兩段都會取消。只想換其中一段的司機，請用「改派」。'
      : '確定取消這張單？',
);

/** "13:50": the time of day only, for the 行程進度 line. */
const clock = (iso: string) => shortTime(iso).split(' ')[1] ?? '';
/** What the driver reported so far, in one line. */
const progressText = computed(() => progressLine(order.value?.progress, clock));
/** The one who drives it (the driver, or the dispatcher on 這單我自己做) reports the next step. */
const drivesIt = computed(() => order.value?.status === 'ASSIGNED' && (!isDispatcher.value || selfDriven.value));
const nextProgress = computed(() => {
  const progress = order.value?.progress;
  if (!drivesIt.value || !progress) return null;
  // 拼車: after 已出發, each party is reported on its own in 拼車乘客.
  if (order.value?.carpool) return progress.departedAt ? null : PROGRESS_STEPS[0];
  return PROGRESS_STEPS.find((one) => !progress[one.field]) ?? null;
});

/**
 * 行程進度 as the one who drives is asked for it at the top of the page, worded by how close the
 * pickup time is: calm while there is time, urgent from 30 minutes before (出發) or once the time
 * has passed (到了上車點).
 */
const progressAsk = computed(() => {
  const step = nextProgress.value;
  const o = order.value;
  if (!step || !o) return null;
  const left = new Date(o.pickupAt).getTime() - Date.now();
  if (step.step === 'DEPARTED') {
    if (left > 30 * 60_000) return { text: '出發時按「已出發」', urgent: false };
    return { text: o.immediate ? '即時單，出發了嗎？' : '快到時間了，出發了嗎？', urgent: true };
  }
  if (step.step === 'ARRIVED') {
    // A 即時單's time is when it went out: it has "passed" from the start, so nothing is late yet.
    if (left > 0 || o.immediate) return { text: '到了上車點就按「已到上車點」', urgent: false };
    return { text: '過了出發時間，到了上車點就按', urgent: true };
  }
  return { text: '乘客上車後按「乘客已上車」', urgent: false };
});

/**
 * Two steps are also asked in a sheet, once each per order on this phone, when the page is opened:
 * 出發了嗎 from 30 minutes before the pickup time, 到了上車點嗎 once it has passed (a 即時單,
 * whose time passed when it went out: 15 minutes after 已出發). Not right after a step was
 * reported, and never again after 稍後 / 還沒; the card at the top keeps asking.
 */
const progressPrompt = ref<(typeof PROGRESS_STEPS)[number] | null>(null);
let promptOnLoad = true;

function checkProgressPrompt() {
  const step = nextProgress.value;
  const o = order.value;
  if (!step || !o || pending.value || editingTrip.value) return;
  const left = new Date(o.pickupAt).getTime() - Date.now();
  const departed = o.progress?.departedAt ? Date.now() - new Date(o.progress.departedAt).getTime() : 0;
  const arrivalDue = o.immediate ? departed >= 15 * 60_000 : left <= 0;
  const due = (step.step === 'DEPARTED' && left <= 30 * 60_000) || (step.step === 'ARRIVED' && arrivalDue);
  if (!due) return;
  const key = `md:progress-prompt:${o.id}:${step.step}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // Without storage the sheet may come again next time; the card asks anyway.
  }
  progressPrompt.value = step;
}

/** 拼車: one party's 已到上車點, 已上車, 乘客沒出現 or 已下車. */
async function reportParty(seatId: string, step: string, label: string) {
  busy.value = true;
  try {
    order.value = await api<Detail>('POST', `/orders/${id.value}/carpool-seats/${seatId}/progress`, { step });
    toast(`已回報：${label}`);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function setPartyPaid(seatId: string, paid: boolean) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/carpool-seats/${seatId}/payment`, { paid });
    toast(paid ? '已記為已收款' : '已改回未收款');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function reportProgress(step: string, label: string) {
  progressPrompt.value = null;
  busy.value = true;
  try {
    order.value = await api<Detail>('POST', `/orders/${id.value}/progress`, { step });
    toast(`已回報：${label}`);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

/** 知道了: the driver confirms the dispatcher's change; the dispatcher is told. */
async function ackChange() {
  busy.value = true;
  try {
    order.value = await api<Detail>('POST', `/orders/${id.value}/change-ack`);
    toast('已確認，出單者會收到通知');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

/**
 * 還沒人接 close to the time: 3 hours before pickup the dispatcher is asked to raise the price and
 * paste the order again; a 即時單, once 10 minutes have gone by (IMMEDIATE_UNCLAIMED_MINUTES in
 * shared/src/schemas.ts). Says what is late, or null when it does not apply.
 */
const unclaimedSoon = computed(() => {
  const o = order.value;
  if (!o || !isDispatcher.value || o.status !== 'OPEN' || selfDriven.value) return null;
  if (o.immediate) {
    const waited = Date.now() - new Date(o.pickupAt).getTime();
    return waited < 10 * 60_000 ? null : `即時單出了 ${Math.floor(waited / 60_000)} 分鐘，還沒人接`;
  }
  const left = new Date(o.pickupAt).getTime() - Date.now();
  if (left <= 0 || left > 3 * 3_600_000) return null;
  return `出發前${left < 3_600_000 ? `${Math.max(1, Math.round(left / 60_000))} 分鐘` : `不到 ${Math.ceil(left / 3_600_000)} 小時`}，還沒人接`;
});
/** Set once the driver price went up on this page: the text pasted again says 加價. */
const raised = ref(false);
/** 帳 folded for the dispatcher; opened to change the price. */
const moneyOpen = ref(false);

async function startRaise() {
  moneyOpen.value = true;
  editPrices();
  await nextTick();
  document.getElementById('detail-money')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function repost() {
  const share = order.value?.share;
  if (!share) return;
  const text = inWeChat ? share.dispatch.wechat : share.dispatch.whatsapp;
  void copy(raised.value ? `【加價】${text}` : text, '已複製，回到群裡長按輸入框貼上');
}

/** 修改行程 is waiting for a driver's 知道了: on this leg or, for 接駁, on either. */
const changeWaiting = computed(() => Boolean(order.value?.change || order.value?.journey?.legs.some((leg) => leg.changePending)));

/** The dispatcher's page opens with what to do now; the rest folds into 行程, 乘客 and 帳. */
const foldDetails = computed(() => isDispatcher.value && !ownTrip.value);
const tripSummary = computed(() => {
  const o = order.value;
  if (!o) return '';
  return `${o.immediate ? '即時 ' : ''}${pickup(o.pickupAt)} · ${o.origin} → ${o.destination}`;
});
const passengerSummary = computed(() => {
  const o = order.value;
  if (!o) return '';
  if (o.carpool) return `拼車 ${o.carpool.partyCount} 組 · ${o.passengers} 人`;
  return [o.passengerName ?? '乘客', o.passengerContact, o.passengerConfirmedAt ? (o.passengerConfirmedByDispatcher ? '你代確認' : '已確認') : '還沒確認']
    .filter(Boolean)
    .join(' · ');
});
const moneySummary = computed(() => {
  const o = order.value;
  if (!o) return '';
  return [
    o.charter?.driverHourly ? `出單價 ${money(o.driverPrice)}（每小時 ${money(o.charter.driverHourly)}）` : `出單價 ${money(o.driverPrice) || '未填'}`,
    tripPriceHere.value && o.passengerPrice ? `乘客價 ${money(o.passengerPrice)}` : '',
    o.status === 'CANCELLED' || o.carpool ? '' : o.paidAt ? '已收款' : '未收款',
    canSettle.value ? (o.settledAt ? '已結清' : '未結清') : '',
  ]
    .filter(Boolean)
    .join(' · ');
});

/** 修改行程: time, places and load; with 接駁 the time is this leg's, the places the trip's. */
const editingTrip = ref(false);
const tripForm = reactive({
  pickupAt: '',
  origin: '',
  destination: '',
  transferPlace: '',
  passengers: '',
  luggage: '',
  vehicleType: '',
  flightNo: '',
  notes: '',
  /** 包車: the hours booked; the totals follow the prices an hour. */
  charterHours: '',
});
let tripBefore = { ...tripForm };

function editTrip() {
  const o = order.value;
  if (!o) return;
  Object.assign(tripForm, {
    pickupAt: toLocalInput(new Date(o.pickupAt)),
    // 往返: each leg's places are its own and change on that leg only; 接駁: the trip's ends.
    origin: o.journey && o.journey.kind !== 'ROUND_TRIP' ? o.journey.origin : o.origin,
    destination: o.journey && o.journey.kind !== 'ROUND_TRIP' ? o.journey.destination : o.destination,
    transferPlace: o.journey?.transferPlaces[0] ?? '',
    passengers: String(o.passengers),
    luggage: String(o.luggage),
    vehicleType: o.vehicleType ?? '',
    flightNo: o.flightNo ?? '',
    notes: o.notes ?? '',
    charterHours: o.charter ? String(o.charter.minutes / 60) : '',
  });
  tripBefore = { ...tripForm };
  editingTrip.value = true;
}

async function saveTrip() {
  const body: Record<string, unknown> = {};
  // Number inputs hand back numbers: compare as text.
  const changed = (field: keyof typeof tripForm) => String(tripForm[field]).trim() !== String(tripBefore[field]).trim();
  if (changed('pickupAt')) body.pickupAt = fromLocalInput(tripForm.pickupAt);
  for (const field of ['origin', 'destination', 'vehicleType'] as const) if (changed(field)) body[field] = String(tripForm[field]).trim();
  if (order.value?.journey && !roundTrip.value && changed('transferPlace')) body.transferPlace = tripForm.transferPlace.trim();
  if (changed('passengers')) body.passengers = Number(tripForm.passengers);
  if (changed('luggage')) body.luggage = Number(tripForm.luggage);
  if (changed('flightNo')) body.flightNo = String(tripForm.flightNo).trim() || null;
  if (changed('notes')) body.notes = String(tripForm.notes).trim() || null;
  if (order.value?.charter && changed('charterHours')) body.charterMinutes = Math.round(Number(tripForm.charterHours) * 60);
  if (Object.keys(body).length === 0) {
    editingTrip.value = false;
    return;
  }
  busy.value = true;
  try {
    const updated = await api<Detail>('PATCH', `/orders/${id.value}/trip`, body);
    order.value = updated;
    editingTrip.value = false;
    toast(updated.change || updated.journey?.legs.some((leg) => leg.changePending) ? '已修改，已通知接單司機確認' : '已修改');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function load() {
  try {
    order.value = await api<Detail>('GET', `/orders/${id.value}`);
    error.value = '';
    // When the page is opened or comes back, not on every refresh.
    if (promptOnLoad) {
      promptOnLoad = false;
      checkProgressPrompt();
    }
  } catch (e) {
    error.value = errorText(e);
  }
}

/** An action waiting for the driver to confirm it in the bottom sheet, with what will follow. */
const pending = ref<{ path: string; done: string; question: string; note: string | null; label: string } | null>(null);

/** What cancelling sets off, said before the driver confirms it. */
const cancelNote = computed(() => {
  const o = order.value;
  if (!o) return null;
  const lines = [
    o.serviceFee ? '平台服務費會退回。' : null,
    o.journey
      ? o.journey.legs.some((leg) => leg.status === 'ASSIGNED' && !leg.selfDrive)
        ? '已接單的司機會收到取消通知，打開連結會看到已取消，最好另外通知他們。'
        : null
      : o.status === 'ASSIGNED' && !selfDriven.value
        ? '已接單的司機打開連結會看到已取消，請另外通知他。'
        : null,
  ].filter(Boolean);
  return lines.length ? lines.join('') : null;
});

function ask(path: string, done: string, question: string, label: string, note: string | null = null) {
  pending.value = { path, done, question, note, label };
}

async function confirmPending() {
  const action = pending.value;
  pending.value = null;
  if (action?.path === 'release') await release();
  else if (action?.path === 'passenger-confirmation') await setConfirmedForPassenger(true);
  else if (action) await act(action.path, action.done);
}

/** 取消接單: the order (with 接駁, this leg) goes back to the group, so the page is no longer the driver's. */
async function release() {
  busy.value = true;
  try {
    await api('POST', `/orders/${id.value}/release`);
    toast('已取消接單');
    await router.replace('/app/orders');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function act(path: string, done: string) {
  busy.value = true;
  try {
    order.value = await api<Detail>('POST', `/orders/${id.value}/${path}`);
    toast(done);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

/** 接單池: list the order for every signed-in driver, or take it out; only while nobody has claimed it. */
/** 收款: show the ways to pay on the passenger's page, or mark the fare received (the whole trip for 接駁). */
async function setPayment(body: { showPaymentMethods?: boolean; paid?: boolean }, done: string) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/payment`, body);
    toast(done);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

/** Done or due and not marked received: remind the dispatcher to check their account. */
const remindPayment = computed(() => {
  const o = order.value;
  // 拼車: each party's fare is marked in 拼車乘客.
  if (!o || !isDispatcher.value || o.carpool || o.paidAt || o.status === 'CANCELLED' || o.status === 'OPEN') return false;
  // A 即時單's time is when it was put out: the fare is due once the passenger is on board.
  if (o.immediate) return o.status === 'COMPLETED' || Boolean(o.progress?.pickedUpAt);
  return o.status === 'COMPLETED' || new Date(o.pickupAt).getTime() <= Date.now();
});

/** 已結清: only once the trip is done, and only when someone else drove it who is still there. */
const canSettle = computed(() => order.value?.status === 'COMPLETED' && !order.value.selfDrive && !order.value.driverDeleted);

/**
 * The page follows the order's stage. While it waits for a driver, the text to paste into groups
 * comes right after the trip; once taken, the driver does. Sections keep their place in the
 * markup and are arranged with flex `order`, so each is written once.
 */
const waitingForDriver = computed(() => isDispatcher.value && order.value?.status === 'OPEN' && !taken.value && !selfDriven.value);

/** 行程群 folded to one line: what is set up now. */
const tripGroupSummary = computed(() => {
  const group = order.value?.tripGroup;
  if (!group) return ownTrip.value ? '還沒加上，可讓乘客進群' : '還沒加上，可讓乘客和接單司機一起進群';
  if (group.expired) return '微信群二維碼已過期，請重新上傳';
  return group.platform === 'WHATSAPP' ? '已加上 WhatsApp 群' : `已加上微信群，${shortTime(group.expiresAt ?? null)} 前有效`;
});

async function setSettled(settled: boolean) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/settlement`, { settled });
    toast(settled ? '已記為已結清' : '已改回未結清');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

/** 出單者代確認, or taking it back; the whole 往返 or 接駁 at once, as the passenger's own would. */
async function setConfirmedForPassenger(confirmed: boolean) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/passenger-confirmation`, { confirmed });
    toast(confirmed ? '已代乘客確認' : '已改回未確認');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

function askConfirmForPassenger() {
  ask(
    'passenger-confirmation',
    '已代乘客確認',
    order.value?.journey ? `確定已經和乘客確認過整張${tripWord.value}？` : '確定已經和乘客確認過行程？',
    '代乘客確認',
    '接單司機會看到「出單者代確認」；乘客打開確認連結，會看到你已代為確認。',
  );
}

async function setPool(inPool: boolean) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/pool`, { inPool });
    toast(inPool ? '已放到接單池' : '已從接單池取出');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

/** 行程群: a WhatsApp invite link, a WeChat group QR, or none. */
const groupLink = ref('');
const editingGroup = ref(false);

async function setTripGroup(body: Record<string, unknown>, done: string) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/trip-group`, body);
    editingGroup.value = false;
    groupLink.value = '';
    toast(done);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function pickGroupQr(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    await setTripGroup({ platform: 'WECHAT', qrImage: await imageForUpload(file) }, '已加上行程群');
  } catch {
    toast('無法讀取這張圖片');
  }
}

const reveal = ref<number | null>(null);
const editingReveal = ref(false);

function editReveal() {
  reveal.value = order.value?.contactRevealMinutes ?? null;
  editingReveal.value = true;
}

async function saveReveal() {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/contact-reveal`, { contactRevealMinutes: reveal.value });
    editingReveal.value = false;
    toast('已更新');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

async function copy(text: string | undefined | null, done: string) {
  if (!text) return;
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

function editPrices() {
  const o = order.value;
  if (!o) return;
  // 包車 is priced by the hour: its prices an hour are edited, and the totals follow.
  const driverPrice = o.charter ? o.charter.driverHourly : o.driverPrice;
  const passengerPrice = o.charter ? o.charter.passengerHourly : o.passengerPrice;
  prices.currency = driverPrice?.currency ?? passengerPrice?.currency ?? 'HKD';
  prices.passengerCurrency = passengerPrice?.currency ?? prices.currency;
  prices.driver = driverPrice ? String(driverPrice.amount) : '';
  // 自己做 shows one price, the driver price when no passenger price was set; editing keeps that figure.
  const passenger = passengerPrice ?? (ownTrip.value ? driverPrice : null);
  if (passenger) prices.passengerCurrency = passenger.currency;
  prices.passenger = passenger ? String(passenger.amount) : '';
  editingPrices.value = true;
}

async function patchPrices(body: Record<string, unknown>, done: string) {
  busy.value = true;
  try {
    order.value = await api<Detail>('PATCH', `/orders/${id.value}/prices`, body);
    editingPrices.value = false;
    toast(done);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

function savePrices() {
  const money = (value: string, currency: string) => (value ? { amount: Number(value), currency } : null);
  // 接駁: the second leg has no passenger price of its own.
  // 包車: its prices an hour, the totals worked out by the API.
  const charter = Boolean(order.value?.charter);
  const body: Record<string, unknown> = tripPriceHere.value
    ? { [charter ? 'passengerHourly' : 'passengerPrice']: money(prices.passenger, prices.passengerCurrency) }
    : {};
  // The driver price (and its currency) is fixed once a driver has taken the order.
  if (order.value?.status === 'OPEN') {
    body[charter ? 'driverHourly' : 'driverPrice'] = money(prices.driver, prices.currency);
    const before = charter ? order.value.charter!.driverHourly : order.value.driverPrice;
    if (prices.driver && (!before || (before.currency === prices.currency && Number(prices.driver) > before.amount))) raised.value = true;
  }
  return patchPrices(body, '價格已更新');
}

/**
 * The order changes while the dispatcher looks at it (a driver claims it, the passenger confirms),
 * so it is read again every 10 seconds while on screen and at once when the page comes back.
 * Not while an action is being sent or a sheet is open, and not once the order is finished.
 */
const REFRESH_MS = 10_000;
let timer: ReturnType<typeof setInterval> | undefined;

function refresh() {
  if (document.visibilityState !== 'visible' || busy.value || pending.value || editingTrip.value || progressPrompt.value || !live.value) return;
  void load();
}

function onVisible() {
  if (document.visibilityState !== 'visible') return;
  promptOnLoad = true;
  refresh();
}

onMounted(() => {
  void load();
  timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', onVisible);
});
watch(id, () => {
  order.value = null;
  editingPrices.value = false;
  editingReveal.value = false;
  void load();
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('訂單詳情')" :fallback="isDispatcher ? '/app/orders?tab=dispatched' : '/app/orders'" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <div v-if="order" class="detail__body">
      <!-- Where the order stands: 已出單, 有人接, 乘客確認. -->
      <ol v-if="order.status !== 'CANCELLED' && !ownTrip && !doneForDriver" class="detail__steps" style="order: 1" :aria-label="t('進度')">
        <li class="done">{{ t('已出單') }}</li>
        <li :class="{ done: order.claimedAt }">{{ order.driverDeleted ? t('司機已刪除') : order.driver?.name ? t(`${order.driver.name} 接單`) : t('有人接') }}</li>
        <li :class="{ done: order.passengerConfirmedAt }">{{ t('乘客確認') }}</li>
      </ol>

      <section v-if="cancelledForDriver" class="card detail__ended" style="order: 0">
        <strong>{{ t('這張單已取消') }}</strong>
        <p>{{ order.cancelledAt ? t(`已在 ${shortTime(order.cancelledAt)} 取消，不用去接了。有疑問請聯絡出單者。`) : t('不用去接了。有疑問請聯絡出單者。') }}</p>
      </section>
      <section v-if="doneForDriver" class="card detail__ended" style="order: 0">
        <strong>{{ t('行程已完成') }}</strong>
        <p>
          {{ order.completedAt ? t(`${shortTime(order.completedAt)} 完成。`) : '' }}{{ order.settledAt ? t(`出單者 ${shortTime(order.settledAt)} 標記已結清。`) : t('出單者還沒標記已結清。') }}
        </p>
      </section>

      <!-- 出單者改了行程: the driver reads what changed and confirms it. -->
      <section v-if="!isDispatcher && order.change && live" class="detail__remind detail__remind--change" style="order: 0">
        <p>
          {{ t(`出單者改了行程：${order.change.summary}`) }}
          <small>{{ t(`${shortTime(order.change.at)} 修改。請看下面的新行程，沒問題就按「知道了」；不能做可以取消接單。`) }}</small>
        </p>
        <button class="button" type="button" :disabled="busy" @click="ackChange">{{ t('知道了') }}</button>
      </section>

      <!-- 現在要做的事: the dispatcher's next step at this stage of the order, first on the page. -->
      <div
        v-if="
          (live && progressAsk) ||
          (isDispatcher && (unclaimedSoon || waitingForDriver || changeWaiting || remindPayment || (canSettle && !order.settledAt) || (remindPassenger && order.share)))
        "
        class="detail__next"
        style="order: 2"
      >
        <span class="section-label">{{ t('現在要做的事') }}</span>
        <!-- 行程進度: the one who drives reports each step here; the dispatcher and the passenger see it. -->
        <section v-if="live && progressAsk && nextProgress" class="detail__remind" :class="{ 'detail__remind--calm': !progressAsk.urgent }">
          <p>
            {{ t(progressAsk.text) }}
            <small>{{ t('按一下，出單者和乘客就知道你到哪了，不用再打給你。') }}</small>
          </p>
          <button class="button" type="button" :disabled="busy" @click="reportProgress(nextProgress.step, nextProgress.label)">
            {{ t(nextProgress.label) }}
          </button>
        </section>
        <template v-if="isDispatcher">
          <section v-if="unclaimedSoon" class="detail__remind">
            <p>
              {{ t(unclaimedSoon) }}
              <small>{{ t('可以加價，再貼一次到群裡；有人接會通知你。') }}</small>
            </p>
            <div class="detail__pair">
              <button class="button secondary" type="button" :disabled="busy" @click="startRaise">{{ t('改出單價') }}</button>
              <button class="button" type="button" @click="repost"><AppIcon name="copy" :size="18" />{{ raised ? t('複製加價重發') : t('複製重發') }}</button>
            </div>
          </section>
          <section v-else-if="waitingForDriver" class="detail__remind">
            <p>
              {{ t('等司機搶') }}
              <small>{{ t('把下面的群文字貼到群裡；有人接會通知你。') }}</small>
            </p>
          </section>
          <section v-if="changeWaiting" class="detail__remind">
            <p>
              {{ t('已通知接單司機行程有修改') }}
              <small>{{ t('等他按「知道了」；急的話可以直接打給他。') }}</small>
            </p>
          </section>

        <!-- The moment to send the passenger their link: a driver is set, and the passenger has not confirmed. -->
        <section v-if="remindPayment" class="detail__remind">
          <p>
            {{ t('乘客付款了嗎？') }}
            <small>{{ t('查過自己的帳戶，收到了就按「已收款」。乘客直接付給你，平台不經手。') }}</small>
          </p>
          <button class="button" type="button" :disabled="busy" @click="setPayment({ paid: true }, '已記為已收款')">{{ t('已收款') }}</button>
        </section>

        <section v-if="isDispatcher && canSettle && !order.settledAt" class="detail__remind">
          <p>
            {{ t(`和${order.driver?.name ?? '接單司機'}結清了嗎？`) }}
            <small>{{ t('你們自己結，結好了按「已結清」，司機那邊也會看到。平台不經手、不核對。') }}</small>
          </p>
          <button class="button" type="button" :disabled="busy" @click="setSettled(true)">{{ t('已結清') }}</button>
        </section>

        <section v-if="remindPassenger && order.share" class="detail__remind">
          <p>
            {{ selfDriven ? t('這單你自己做，把確認連結傳給乘客') : t(`${order.driver?.name ?? '司機'} 接了這張單，把確認連結傳給乘客`) }}
            <small>{{ t('乘客會看到司機和車牌，按一下就確認行程') }}</small>
          </p>
          <button class="button" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製給乘客') }}
          </button>
          <!-- 出單者代確認: many passengers say yes by phone and never press the link. -->
          <button class="button secondary" type="button" :disabled="busy" @click="askConfirmForPassenger">{{ t('乘客已答應，我代乘客確認') }}</button>
        </section>
        </template>
      </div>

      <!-- The trip in the order of the group text: time, route, load, then what must be noticed. -->
      <component :is="foldDetails ? 'details' : 'section'" class="card" :class="{ detail__fold: foldDetails }" style="order: 3">
        <summary v-if="foldDetails">
          <span class="detail__fold-text">
            <strong>{{ t('行程') }}</strong>
            <span class="hint">{{ t(tripSummary) }}</span>
          </span>
          <AppIcon name="chevron" class="detail__fold-arrow" />
        </summary>
        <div class="detail__top">
          <strong class="detail__time">{{ pickup(order.pickupAt) }}<span v-if="order.immediate" class="now-tag detail__now">{{ t('即時') }}</span></strong>
          <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
        </div>
        <div class="detail__route"><RoutePoints :origin="order.origin" :destination="order.destination" :waypoints="order.waypoints" /></div>
        <div class="detail__meta">
          <span>{{ t(loadLine(order.passengers, order.luggage, order.vehicleType)) }}</span>
          <span v-if="order.journey" class="leg-tag">{{ t(`${roundTrip ? '往返' : '接駁'} ${legLabel(order.journey)}`) }}</span>
          <span v-if="together" class="leg-tag">{{ t('同一位司機來回') }}</span>
          <span v-if="order.charter" class="leg-tag">{{ t(`包車 ${charterHours(order.charter.minutes)}`) }}</span>
          <span v-if="order.requiredPlates.length" class="gold-tag">{{ t(plateRequirement(order.requiredPlates)) }}</span>
          <!-- The driver's price sits with the trip, as on the claim page; once it is over, 這趟的帳 says it. -->
          <strong v-if="!isDispatcher && !endedForDriver" class="detail__trip-price">{{ money(order.driverPrice) || t('出單價未填') }}</strong>
        </div>
        <p v-if="order.journey && !roundTrip" class="detail__line">{{ t(`在 ${order.journey.transferPlaces.join('、')} 換車`) }}</p>
        <p v-if="order.flightNo" class="detail__line">{{ t(`航班：${order.flightNo}`) }}</p>
        <!-- 包車: until when, and the 超時 and 另計 rules; the prices an hour the driver's, as the group text says. -->
        <CharterRules
          v-if="order.charter"
          :minutes="order.charter.minutes"
          :start="order.immediate ? null : order.pickupAt"
          :hourly="order.charter.driverHourly"
          :total="order.driverPrice"
          :overtime-hourly="order.charter.overtimeDriverHourly"
          :overtime-unit-minutes="order.charter.overtimeUnitMinutes"
          :overtime-grace-minutes="order.charter.overtimeGraceMinutes"
          :extras="order.charter.extras"
        />
        <p v-if="order.notes" class="detail__note">{{ t(order.notes) }}</p>
        <p v-if="progressText && !endedForDriver" class="detail__progress">{{ t(progressText) }}</p>
        <button v-if="isDispatcher && live && !order.carpool" class="chip detail__edit-trip" type="button" :disabled="busy" @click="editTrip">{{ t('修改行程') }}</button>
        <RouterLink v-if="isDispatcher && order.carpool?.id" class="chip detail__edit-trip" :to="`/app/carpools/${order.carpool.id}`">{{ t('打開拼車') }}</RouterLink>
      </component>

      <!-- 接駁 and 往返: both legs of the order; the dispatcher opens a leg to manage its driver.
           The driver reads it after 乘客 and 出單者: their own leg is already in the trip above. -->
      <section v-if="order.journey && !endedForDriver" class="card" :style="{ order: isDispatcher ? 5 : 8 }">
        <span class="section-label">
          {{
            roundTrip
              ? isDispatcher
                ? t('整張往返單（去程和回程），點一程查看')
                : t('整張往返單（去程和回程）')
              : isDispatcher
                ? t('整張接駁單（兩段），點一段管理它的司機')
                : t('整張接駁單（兩段）')
          }}
        </span>
        <JourneyLegs :legs="order.journey.legs" :current="order.journey.legIndex" :kind="order.journey.kind" />
      </section>

      <!-- The passenger: for the dispatcher after the group text or the driver; for the driver right under the trip and
           above 出單者, so the two are never mixed up, even before the phone is shown. -->
      <component
        :is="foldDetails ? 'details' : 'section'"
        v-if="!endedForDriver"
        class="card"
        :class="{ detail__fold: foldDetails }"
        :style="{ order: isDispatcher ? 10 : 4 }"
      >
        <summary v-if="foldDetails">
          <span class="detail__fold-text">
            <strong>{{ t('乘客') }}</strong>
            <span class="hint">{{ t(passengerSummary) }}</span>
          </span>
          <AppIcon name="chevron" class="detail__fold-arrow" />
        </summary>
        <CarpoolParties
          v-if="order.carpool"
          :carpool="order.carpool"
          :destination="order.destination"
          :drives="drivesIt"
          :dispatcher="isDispatcher"
          :busy="busy"
          @progress="reportParty"
          @paid="setPartyPaid"
        />
        <template v-else>
        <span :class="isDispatcher ? 'section-label' : 'role-tag role-tag--teal'">{{ isDispatcher && order.passengerName ? t(order.passengerName) : t('乘客') }}</span>
        <div v-if="!isDispatcher" class="detail__person">
          <strong>{{ order.passengerName ? t(order.passengerName) : t('沒有留名') }}</strong>
        </div>
        <strong v-if="order.passengerContact" class="detail__phone">{{ order.passengerContact }}</strong>
        <p v-else-if="order.contactEnded" class="detail__waiting">{{ t('行程已結束，乘客電話不再顯示。有需要請聯絡出單者。') }}</p>
        <p v-else class="detail__waiting">{{ t(`乘客電話 ${shortTime(order.contactRevealAt)} 顯示。之前如需安排，請聯絡出單者。`) }}</p>
        <p class="detail__confirmed" :class="{ 'detail__confirmed--yes': order.passengerConfirmedAt }">
          {{ t(confirmedText) }}
          <button v-if="canConfirmForPassenger" class="chip" type="button" :disabled="busy" @click="askConfirmForPassenger">{{ t('代乘客確認') }}</button>
          <button
            v-else-if="isDispatcher && order.passengerConfirmedByDispatcher && live"
            class="chip"
            type="button"
            :disabled="busy"
            @click="setConfirmedForPassenger(false)"
          >
            {{ t('改回未確認') }}
          </button>
        </p>
        <!-- The passenger may not have seen the car or plate: worth a call before setting out. -->
        <p v-if="!isDispatcher && order.passengerConfirmedByDispatcher && live" class="hint">
          {{ t('乘客沒有自己按確認，可能還沒看過你的車和車牌，出發前可以先聯絡乘客或出單者。') }}
        </p>
        <div v-if="order.passengerContact" class="detail__pair detail__gap">
          <a class="button secondary" :href="`tel:${order.passengerContact.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電乘客') }}</a>
          <button class="button secondary" type="button" @click="copy(order.passengerContact, '已複製')">{{ t('複製號碼') }}</button>
        </div>
        </template>
        <div v-if="isDispatcher && !ownTrip" class="detail__divided detail__reveal">
          <template v-if="!editingReveal">
            <span class="detail__reveal-text">{{ order.contactRevealMinutes == null ? t('接單司機搶到就看到乘客電話') : t(`接單司機${revealLabel(order.contactRevealMinutes)}看到乘客電話`) }}</span>
            <button v-if="live" class="chip" type="button" @click="editReveal">{{ t('修改') }}</button>
          </template>
          <template v-else>
            <RevealSelect v-model="reveal" class="select--inline" />
            <button class="chip" type="button" @click="editingReveal = false">{{ t('取消') }}</button>
            <button class="chip chip--on" type="button" :disabled="busy" @click="saveReveal">{{ t('儲存') }}</button>
          </template>
        </div>
        <p v-if="isDispatcher && !selfDriven" class="hint detail__protect">{{ t('行程結束後，接單司機就看不到乘客電話。') }}</p>

        <!-- 行程群: the driver joins the group the dispatcher made, while they may see the passenger. -->
        <div v-if="!isDispatcher && order.tripGroup" class="detail__divided">
          <span class="section-label">{{ t('行程群：乘客、出單者都在裡面') }}</span>
          <TripGroupJoin :group="order.tripGroup" />
        </div>
      </component>

      <!-- 行程群: the dispatcher's own group for this trip, passed on to the passenger and the driver; folded to one line. -->
      <details v-if="isDispatcher && order.status !== 'CANCELLED'" class="card detail__fold" style="order: 14" :open="editingGroup || undefined">
        <summary v-if="ownTrip">
          <span class="detail__fold-text">
            <strong>{{ t('其他設定') }}</strong>
            <span class="hint">{{ t('確認頁顯示的內容、行程群') }}</span>
          </span>
          <AppIcon name="chevron" class="detail__fold-arrow" />
        </summary>
        <summary v-else>
          <span class="detail__fold-text">
            <strong>{{ t('行程群（你、乘客、司機）') }}</strong>
            <span class="hint" :class="{ 'detail__group-expired': order.tripGroup?.expired }">{{ t(tripGroupSummary) }}</span>
          </span>
          <AppIcon name="chevron" class="detail__fold-arrow" />
        </summary>
        <!-- 自己做: what the passenger's page shows, kept here instead of on cards of their own. -->
        <template v-if="ownTrip">
          <label v-if="live && !order.carpool" class="detail__switch">
            <span>{{ t('乘客確認頁顯示價錢') }}</span>
            <input
              class="switch"
              type="checkbox"
              :checked="order.showPassengerPrice"
              :disabled="busy"
              @change="patchPrices({ showPassengerPrice: !order.showPassengerPrice }, '已更新')"
            />
          </label>
          <label v-if="!order.carpool" class="detail__switch detail__divided">
            <span>
              {{ t('乘客確認頁顯示收款方式') }}
              <small>{{ order.journey ? t(`整張${tripWord}一起顯示，乘客付一次`) : t('顯示時會一併顯示價錢') }}</small>
            </span>
            <input
              class="switch"
              type="checkbox"
              :checked="order.showPaymentMethods"
              :disabled="busy"
              @change="setPayment({ showPaymentMethods: !order.showPaymentMethods }, '已更新')"
            />
          </label>
          <p v-if="order.serviceFee" class="hint detail__divided">
            {{ order.journey ? t(`平台服務費 HK$${order.serviceFee}，整張${tripWord}只收一次，取消會退回`) : t(`平台服務費 HK$${order.serviceFee}，取消會退回`) }}
          </p>
          <div class="detail__divided">
            <span class="section-label">{{ t('行程群（你和乘客）') }}</span>
            <p class="hint" :class="{ 'detail__group-expired': order.tripGroup?.expired }">{{ t(tripGroupSummary) }}</p>
          </div>
        </template>
        <template v-if="order.tripGroup && !editingGroup">
          <p v-if="order.tripGroup.expired" class="detail__group-expired">{{ t('微信群二維碼已超過 7 天，乘客和司機看不到了，請重新上傳。') }}</p>
          <p v-else class="hint">{{ t('乘客確認頁和接單司機都看得到。') }}</p>
          <div class="detail__pair detail__gap">
            <button class="button secondary" type="button" :disabled="busy" @click="editingGroup = true">{{ t('更換') }}</button>
            <button class="button secondary" type="button" :disabled="busy" @click="setTripGroup({ platform: null }, '已移除行程群')">{{ t('移除') }}</button>
          </div>
        </template>
        <template v-else>
          <p class="hint">{{ t('先自己建好群，再把入群方式放這裡。') }}</p>
          <form class="detail__group-form" @submit.prevent="setTripGroup({ platform: 'WHATSAPP', inviteUrl: groupLink.trim() }, '已加上行程群')">
            <input v-model="groupLink" class="line-input" inputmode="url" :aria-label="t('WhatsApp 群邀請連結')" placeholder="https://chat.whatsapp.com/…" />
            <button class="chip chip--on" type="submit" :disabled="busy || !groupLink.trim()">{{ t('加上') }}</button>
          </form>
          <label class="button secondary block detail__gap">
            {{ t('上傳微信群二維碼') }}<input type="file" accept="image/*" hidden @change="pickGroupQr" />
          </label>
          <span class="hint">{{ t('微信群二維碼 7 天後失效。') }}</span>
          <button v-if="editingGroup" class="detail__link" type="button" @click="editingGroup = false">{{ t('取消') }}</button>
        </template>
      </details>

      <!-- Dispatcher: texts to paste into groups and to the passenger -->
      <section v-if="isDispatcher && order.share && live && !ownTrip" class="card" :style="{ order: waitingForDriver ? 6 : taken ? 8 : 15 }">
        <!-- Taken: the group needs to hear that, and the order must not be pasted again. -->
        <template v-if="taken">
          <span class="section-label">{{ t('已有人接，貼回群裡讓大家知道') }}</span>
          <GroupText :text="order.share.claimed ?? ''" />
          <button class="button block" type="button" @click="copy(order.share.claimed, '已複製，貼回群裡吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製「已派出」貼回群') }}
          </button>
        </template>
        <template v-else>
          <span class="section-label">{{ t('貼到群裡') }}</span>
          <GroupText :text="order.share.dispatch.wechat" :link-note="t('藍色的搶單連結會一起複製')" />
          <!-- One main button: the app this page is most likely open next to. -->
          <div class="detail__stack" :class="{ 'detail__stack--whatsapp-first': !inWeChat }">
            <button class="button" :class="{ outline: !inWeChat }" type="button" @click="copy(order.share.dispatch.wechat, '已複製，回到微信群長按輸入框貼上')">
              <AppIcon name="copy" :size="18" />{{ t('複製到微信群') }}
            </button>
            <button class="button" :class="{ outline: inWeChat }" type="button" @click="copy(order.share.dispatch.whatsapp, '已複製，回到 WhatsApp 群長按輸入框貼上')">
              <AppIcon name="copy" :size="18" />{{ t('複製到 WhatsApp') }}
            </button>
          </div>
          <a v-if="!inWeChat" class="detail__wa" :href="whatsappLink(t(order.share.dispatch.whatsapp))" target="_blank" rel="noopener">
            {{ t('直接用 WhatsApp 傳送') }}
          </a>
          <label v-if="order.status === 'OPEN'" class="detail__switch detail__divided">
            <span>
              {{ t('放到接單池') }}
              <small>{{ order.inPool ? t('所有登入的司機都看得到並可以搶') : t('現在只有拿到連結的人看得到') }}</small>
            </span>
            <input class="switch" type="checkbox" :checked="order.inPool" :disabled="busy" @change="setPool(!order.inPool)" />
          </label>
        </template>
        <div v-if="!order.carpool" class="detail__divided">
          <span class="section-label">{{ t('傳給乘客') }}</span>
          <button class="detail__link" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製給乘客的確認訊息') }}
          </button>
        </div>
      </section>

      <!-- Prices: the dispatcher sees both and the spread; the driver's price is in the trip card. -->
      <component
        :is="foldDetails ? 'details' : 'section'"
        v-if="isDispatcher"
        id="detail-money"
        class="card"
        :class="{ detail__fold: foldDetails }"
        style="order: 12"
        :open="foldDetails && (moneyOpen || editingPrices) ? true : undefined"
      >
        <summary v-if="foldDetails">
          <span class="detail__fold-text">
            <strong>{{ t('帳') }}</strong>
            <span class="hint">{{ t(moneySummary) }}</span>
          </span>
          <AppIcon name="chevron" class="detail__fold-arrow" />
        </summary>
        <!-- 自己做: one price, what the passenger pays, and whether it came in. -->
        <template v-if="ownTrip && !editingPrices && !order.carpool">
          <div class="detail__paid">
            <span class="detail__price">
              <span class="section-label">{{ t('價錢') }}</span>
              <strong>{{ money(order.passengerPrice ?? order.driverPrice) || t('未填') }}</strong>
            </span>
            <button v-if="live" class="chip" type="button" @click="editPrices">{{ t('修改') }}</button>
          </div>
          <div v-if="order.status !== 'CANCELLED'" class="detail__paid detail__divided">
            <span class="detail__paid-state" :class="{ 'detail__paid-state--yes': order.paidAt }">
              {{ order.paidAt ? t(`${shortTime(order.paidAt)} 已收款`) : t('未收款') }}
            </span>
            <button class="chip" type="button" :disabled="busy" @click="setPayment({ paid: !order.paidAt }, order.paidAt ? '已改回未收款' : '已記為已收款')">
              {{ order.paidAt ? t('改回未收款') : t('標記已收款') }}
            </button>
          </div>
        </template>
        <template v-else-if="!editingPrices">
          <!-- 這單我自己做 has no price for another driver, so the line is left out unless one was set. -->
          <div v-if="order.driverPrice || !order.selfDrive" class="detail__price">
            <span class="section-label">{{ t('出單價') }}</span>
            <strong>{{ money(order.driverPrice) || t('未填') }}</strong>
          </div>
          <template v-if="isDispatcher">
            <p v-if="tripPriceHere" class="detail__line">
              {{ t(`乘客價 ${money(order.passengerPrice) || '未填'}`)
              }}<template v-if="order.charter?.passengerHourly">{{ t(`（每小時 ${money(order.charter.passengerHourly)}）`) }}</template
              ><template v-if="order.margin">{{ t(`，差價 ${money(order.margin)}`) }}</template>
            </p>
            <p v-else-if="order.carpool" class="detail__line">{{ t('拼車沒有整張單的乘客價：每組按每位價錢乘人數，在「拼車乘客」查看') }}</p>
            <p v-else class="detail__line">{{ t(roundTrip ? '乘客價整張單一個，在去程查看和修改' : '乘客價整張單一個，在第 1 段查看和修改') }}</p>
            <p v-if="order.serviceFee" class="hint detail__fee">
              {{ order.journey ? t(`平台服務費 HK$${order.serviceFee}，整張${tripWord}只收一次，取消會退回`) : t(`平台服務費 HK$${order.serviceFee}，取消會退回`) }}
            </p>
            <template v-if="live">
              <label v-if="tripPriceHere" class="detail__switch detail__divided">
                <span>{{ t('乘客確認頁顯示乘客價') }}</span>
                <input
                  class="switch"
                  type="checkbox"
                  :checked="order.showPassengerPrice"
                  :disabled="busy"
                  @change="patchPrices({ showPassengerPrice: !order.showPassengerPrice }, '已更新')"
                />
              </label>
              <button v-if="!(order.carpool && order.selfDrive)" class="button secondary block detail__gap" type="button" @click="editPrices">{{ t('修改價格') }}</button>
            </template>
          </template>
        </template>
        <form v-if="editingPrices" @submit.prevent="savePrices">
          <template v-if="!ownTrip">
            <span class="section-label">
              {{
                order.status === 'OPEN'
                  ? order.charter
                    ? t('每小時出單價')
                    : t('出單價')
                  : order.charter
                    ? t('每小時出單價（已有司機接單，不能再改）')
                    : t('出單價（已有司機接單，不能再改）')
              }}
            </span>
            <div class="amount-line detail__gap-bottom">
              <select v-model="prices.currency" :aria-label="t('出單價幣種')" :disabled="order.status !== 'OPEN'">
                <option value="HKD">HK$</option>
                <option value="CNY">RMB¥</option>
                <option value="MOP">MOP$</option>
              </select>
              <input v-model="prices.driver" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('出單價')" :disabled="order.status !== 'OPEN'" />
            </div>
          </template>
          <span v-if="tripPriceHere" class="section-label">
            {{
              order.charter
                ? ownTrip
                  ? t('每小時價錢')
                  : t('每小時乘客價，只有你看得到')
                : ownTrip
                  ? t('價錢')
                  : order.journey
                    ? t('乘客價（整張單一個價），只有你看得到')
                    : t('乘客價，只有你看得到')
            }}
          </span>
          <div v-if="tripPriceHere" class="amount-line amount-line--quiet detail__gap-bottom">
            <select v-model="prices.passengerCurrency" :aria-label="t('乘客價幣種')">
              <option value="HKD">HK$</option>
              <option value="CNY">RMB¥</option>
              <option value="MOP">MOP$</option>
            </select>
            <input v-model="prices.passenger" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('乘客價')" :placeholder="t('乘客價（選填）')" />
          </div>
          <p v-if="order.charter" class="hint detail__gap-bottom">{{ t(`總價按每小時價錢乘 ${charterHours(order.charter.minutes)}計算。`) }}</p>
          <div class="detail__pair">
            <button class="button secondary" type="button" @click="editingPrices = false">{{ t('取消') }}</button>
            <button class="button" type="submit" :disabled="busy">{{ t('儲存') }}</button>
          </div>
        </form>
        <!-- The dispatcher's 收款與結清 belong with the prices, in one 帳. -->
        <OrderMoneyMarks
          v-if="foldDetails"
          :order="order"
          :is-dispatcher="true"
          :can-settle="canSettle"
          :busy="busy"
          @payment="setPayment"
          @settled="setSettled"
        />
      </component>

      <!-- 結清 for the driver who took it (the dispatcher's marks are in 帳). The platform takes no money and checks nothing. -->
      <section v-if="!isDispatcher && canSettle" class="card detail__money" :style="{ order: doneForDriver ? 4 : 13 }">
        <span class="section-label">{{ doneForDriver ? t('這趟的帳') : t('結清') }}</span>
        <!-- The driver's finished trip: what they are owed, then whether it is settled. -->
        <div v-if="doneForDriver" class="detail__price">
          <span class="section-label">{{ t('出單價') }}</span>
          <strong>{{ money(order.driverPrice) || t('未填') }}</strong>
        </div>
        <OrderMoneyMarks :order="order" :is-dispatcher="false" :can-settle="canSettle" :busy="busy" />
      </section>

      <!-- The driver's own car comes after 出單者: they rarely need to read it. -->
      <section v-if="order.driver && !ownTrip && !endedForDriver" class="card" :style="{ order: isDispatcher ? 7 : 9 }">
        <span :class="isDispatcher ? 'section-label' : 'role-tag role-tag--grey'">{{ selfDriven ? t('這單你自己做') : isDispatcher ? t('接單司機') : t('你的車') }}</span>
        <div class="detail__person">
          <strong>{{ order.driver.name ? t(order.driver.name) : t('沒有留名') }}</strong>
          <span class="hint">{{ t(`${shortTime(order.claimedAt)} 搶到`) }}</span>
        </div>
        <p class="hint detail__car">{{ [order.driver.vehicleType, order.driver.color, plateKind(order.driver)].filter(Boolean).map((part) => t(part as string)).join(' · ') }}</p>
        <PlateTag :hk="order.driver.hkPlate" :macau="order.driver.macauPlate" :mainland="order.driver.mainlandPlate" />
        <div v-if="isDispatcher && !selfDriven" class="detail__pair detail__gap">
          <a class="button secondary" :href="`tel:${order.driver.phone.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電司機') }}</a>
          <button class="button secondary" type="button" @click="copy(order.driver.phone, '已複製號碼')">{{ t('複製號碼') }}</button>
        </div>
        <ContactLines v-if="isDispatcher && !selfDriven" class="detail__gap" :phones="order.driver.phones?.slice(1)" :wechat-id="order.driver.wechatId" :whatsapp="order.driver.whatsapp" />
        <p v-if="isDispatcher && !selfDriven && order.driver.hidePlates" class="hint detail__gap">{{ t('這位司機對乘客隱藏車牌：乘客確認頁不顯示車牌，會提醒乘客上車前先確認。') }}</p>
      </section>
      <!-- 司機已刪除: the platform deleted the driver's account; the order stays the dispatcher's. -->
      <section v-if="isDispatcher && order.driverDeleted && !order.driver" class="card" style="order: 7">
        <span class="section-label">{{ t('接單司機') }}</span>
        <div class="detail__person">
          <strong>{{ t('司機已刪除') }}</strong>
          <span class="hint">{{ t(`${shortTime(order.claimedAt)} 搶到`) }}</span>
        </div>
        <p class="hint">{{ t(order.status === 'COMPLETED' ? '這位司機的帳號已被平台刪除，看不到他的資料和聯絡方式，這單也不用再標記結清。' : '這位司機的帳號已被平台刪除，看不到他的資料和聯絡方式。') }}</p>
      </section>

      <!-- The driver who took the order: how to reach whoever put it out, right after the passenger. -->
      <section v-if="!isDispatcher && order.dispatcherPhone" class="card" style="order: 7">
        <span class="role-tag role-tag--blue">{{ t('出單者') }}</span>
        <div class="detail__person">
          <strong>{{ order.dispatcherName ? t(order.dispatcherName) : t('沒有留名') }}</strong>
          <span v-if="!endedForDriver" class="hint">{{ order.dispatcherPhone }}</span>
        </div>
        <a v-if="endedForDriver" class="button secondary block detail__gap" :href="`tel:${order.dispatcherPhone.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電出單者') }}</a>
        <div v-else class="detail__pair detail__gap">
          <a class="button secondary" :href="`tel:${order.dispatcherPhone.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電出單者') }}</a>
          <button class="button secondary" type="button" @click="copy(order.dispatcherPhone, '已複製號碼')">{{ t('複製號碼') }}</button>
        </div>
        <!-- A finished trip is settled between the two of them, often over WeChat or WhatsApp. -->
        <ContactLines
          v-if="!cancelledForDriver"
          class="detail__gap"
          :phones="doneForDriver ? [] : order.dispatcherContact?.phones?.slice(1)"
          :wechat-id="order.dispatcherContact?.wechatId"
          :whatsapp="order.dispatcherContact?.whatsapp"
        />
        <RouterLink v-if="order.dispatcherPageCode && !endedForDriver" class="button secondary block detail__gap" :to="`/p/${order.dispatcherPageCode}`">{{ t('看出單者的名片') }}</RouterLink>
      </section>

      <!-- What can still be done, least drastic first; cancelling is a quiet red link. -->
      <section v-if="live" class="detail__actions" style="order: 20">
        <button
          v-if="order.status === 'ASSIGNED'"
          class="button block"
          :class="nextProgress ? 'secondary' : 'large'"
          type="button"
          :disabled="busy"
          @click="ask('complete', '已完成', '確定這趟行程已完成？', '標記完成')"
        >
          {{ t('標記完成') }}
        </button>
        <template v-if="isDispatcher">
          <button
            v-if="order.status === 'ASSIGNED'"
            class="button secondary block"
            type="button"
            :disabled="busy"
            @click="
              selfDriven
                ? ask('reopen', '已重新開放搶單', together ? '把這張往返單（去程和回程）放到群裡讓別的司機搶？' : '把這單放到群裡讓別的司機搶？', '交給別的司機')
                : ask(
                    'reopen',
                    '已重新開放搶單',
                    together ? '收回這張往返單（去程和回程），重新讓司機搶？' : '收回這張單，重新讓司機搶？',
                    '改派',
                    '原本接單的司機打開連結會看到單已改派，請另外通知他。',
                  )
            "
          >
            {{ selfDriven ? t('交給別的司機') : t('改派') }}
          </button>
          <button class="detail__cancel" type="button" :disabled="busy" @click="ask('cancel', '已取消', cancelQuestion, order.journey ? `取消整張${tripWord}` : '取消這張單', cancelNote)">
            {{ order.journey ? t(`取消整張${tripWord}`) : t('取消這張單') }}
          </button>
        </template>
        <!-- The driver who took it can give it back until the trip is done; with 接駁, only their own leg. -->
        <button
          v-else-if="order.status === 'ASSIGNED'"
          class="detail__cancel"
          type="button"
          :disabled="busy"
          @click="
            ask(
              'release',
              '已取消接單',
              together
                ? '確定不做這張往返單？去程和回程都會退出。'
                : roundTrip && order.journey
                  ? `確定不做${legName(order.journey.kind, order.journey.legIndex)}？只退出你這一程，另一程不受影響。`
                  : order.journey
                    ? `確定不做第 ${order.journey.legIndex} 段？只退出你這一段，另一段不受影響。`
                    : '確定不做這張單？',
              '取消接單',
              '這單會回到等人搶，群裡同一個連結可以再搶；出單者會收到通知，最好也直接告訴出單者。',
            )
          "
        >
          {{ t('取消接單') }}
        </button>
      </section>

      <!-- 出回程單: the same trip back, the route turned around; from the trip's first leg for 接駁.
           A 往返 already comes back. -->
      <RouterLink v-if="isDispatcher && !roundTrip && !order.charter" class="button secondary block detail__return" style="order: 21" :to="`/app/new?return=${order.journey?.legs[0]?.id ?? order.id}`">
        {{ t('出回程單') }}
      </RouterLink>

      <BottomSheet v-if="editingTrip" :title="t('修改行程')" @close="editingTrip = false">
        <form class="detail__trip-form" @submit.prevent="saveTrip">
          <p v-if="order.status === 'ASSIGNED' || order.journey?.legs.some((leg) => leg.status === 'ASSIGNED' && !leg.selfDrive)" class="hint">
            {{ t('已有司機接了：改了之後會通知他確認。') }}
          </p>
          <p v-if="roundTrip && order.journey" class="hint">
            {{ t(`這裡只改${legName(order.journey.kind, order.journey.legIndex)}的時間、地點和航班；另一程請在上面的行程點進去修改。人數、行李、車型和備註兩程一起改。`) }}
          </p>
          <label class="line-field">
            <span>
              {{
                order.journey
                  ? t(`${legName(order.journey.kind, order.journey.legIndex)}出發時間（香港時間）`)
                  : order.charter
                    ? t('開始時間（香港時間）')
                    : t('出發時間（香港時間）')
              }}
            </span>
            <input v-model="tripForm.pickupAt" class="line-input" type="datetime-local" required />
          </label>
          <!-- 包車: other hours; the totals follow the prices an hour. -->
          <label v-if="order.charter" class="line-field">
            <span>{{ t('包車時數（1 到 24 小時，以半小時為單位）') }}</span>
            <input v-model="tripForm.charterHours" class="line-input" type="number" min="1" max="24" step="0.5" inputmode="decimal" required />
          </label>
          <label class="line-field">
            <span>{{ roundTrip && order.journey ? t(`${legName(order.journey.kind, order.journey.legIndex)}出發地`) : order.charter ? t('上車地點') : t('出發地') }}</span>
            <input v-model="tripForm.origin" class="line-input" maxlength="120" required />
          </label>
          <label v-if="order.journey && !roundTrip" class="line-field">
            <span>{{ t('接駁位置') }}</span>
            <input v-model="tripForm.transferPlace" class="line-input" maxlength="120" required />
          </label>
          <label class="line-field">
            <span>{{ roundTrip && order.journey ? t(`${legName(order.journey.kind, order.journey.legIndex)}目的地`) : order.charter ? t('結束地點') : t('目的地') }}</span>
            <input v-model="tripForm.destination" class="line-input" maxlength="120" required />
          </label>
          <div class="detail__trip-load">
            <label class="line-field">
              <span>{{ t('人數') }}</span>
              <input v-model="tripForm.passengers" class="line-input" type="number" min="1" max="60" inputmode="numeric" required />
            </label>
            <label class="line-field">
              <span>{{ t('行李') }}</span>
              <input v-model="tripForm.luggage" class="line-input" type="number" min="0" max="60" inputmode="numeric" />
            </label>
            <label class="line-field">
              <span>{{ t('車型') }}</span>
              <input v-model="tripForm.vehicleType" class="line-input" maxlength="30" required />
            </label>
          </div>
          <label class="line-field">
            <!-- 往返: each leg has its own flight; this one changes on this leg only. -->
            <span>{{ roundTrip && order.journey ? t(`${legName(order.journey.kind, order.journey.legIndex)}航班號（選填）`) : t('航班號（選填）') }}</span>
            <input v-model="tripForm.flightNo" class="line-input" maxlength="20" />
          </label>
          <label class="line-field">
            <span>{{ t('備註') }}</span>
            <textarea v-model="tripForm.notes" class="line-input" maxlength="500" />
          </label>
          <div class="detail__pair">
            <button class="button secondary" type="button" @click="editingTrip = false">{{ t('取消') }}</button>
            <button class="button" type="submit" :disabled="busy">{{ t('儲存') }}</button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet v-if="pending" :title="t(pending.label)" @close="pending = null">
        <p class="detail__question">{{ t(pending.question) }}</p>
        <p v-if="pending.note" class="hint">{{ t(pending.note) }}</p>
        <div class="detail__pair">
          <button class="button secondary" type="button" @click="pending = null">{{ t('先不要') }}</button>
          <button class="button" type="button" :disabled="busy" @click="confirmPending">{{ t(pending.label) }}</button>
        </div>
      </BottomSheet>

      <!-- 行程進度 asked once at the two times it matters most; 稍後 / 還沒 leaves it to the card at the top. -->
      <BottomSheet
        v-if="progressPrompt"
        :title="progressPrompt.step === 'DEPARTED' ? t('出發了嗎？') : t('到了上車點嗎？')"
        @close="progressPrompt = null"
      >
        <p class="detail__question">{{ t(`${pickup(order.pickupAt)}　${order.origin} 至 ${order.destination}`) }}</p>
        <p class="hint">{{ t('按一下，出單者和乘客就知道你到哪了，不用再打給你。') }}</p>
        <div class="detail__pair">
          <button class="button secondary" type="button" @click="progressPrompt = null">
            {{ progressPrompt.step === 'DEPARTED' ? t('稍後') : t('還沒') }}
          </button>
          <button class="button" type="button" :disabled="busy" @click="reportProgress(progressPrompt.step, progressPrompt.label)">
            {{ t(progressPrompt.label) }}
          </button>
        </div>
      </BottomSheet>
    </div>
  </div>
</template>

<style scoped>
.detail__body {
  display: flex;
  flex-direction: column;
}
.detail__now {
  margin-left: var(--space-sm);
  vertical-align: middle;
}
.detail__fold summary {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  list-style: none;
}
.detail__fold summary::-webkit-details-marker {
  display: none;
}
.detail__fold[open] summary {
  margin-bottom: var(--space-md);
}
.detail__fold-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.detail__fold-arrow {
  color: var(--color-text-muted);
  transition: transform 0.15s;
}
.detail__fold[open] .detail__fold-arrow {
  transform: rotate(90deg);
}
/* The first line under the 收款與結清 label needs no rule above it. */
.detail__money .section-label + .detail__divided {
  margin-top: var(--space-sm);
  padding-top: 0;
  border-top: none;
}
.detail__steps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-xs);
  margin: var(--space-md) 0 var(--space-lg);
  padding: 0;
  text-align: center;
  font-size: var(--font-caption);
  color: var(--color-text-muted);
}
.detail__steps li {
  padding-top: var(--space-sm);
  border-top: 3px solid var(--color-border);
  overflow-wrap: anywhere;
}
.detail__steps li.done {
  border-top-color: var(--color-teal);
  color: var(--color-text);
  font-weight: 700;
}
.detail__paid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.detail__car {
  margin: 0 0 var(--space-sm);
}
.detail__protect {
  margin: var(--space-sm) 0 0;
}
.detail__group-expired {
  margin: 0;
  color: var(--color-gold-ink);
  font-weight: 600;
}
.detail__group-form {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}
.detail__group-form .line-input {
  flex: 1;
  min-width: 0;
}
.detail__settle {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.detail__settle small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.detail__paid-state {
  color: var(--color-gold-ink);
  font-weight: 700;
}
.detail__paid-state--yes {
  color: var(--status-confirmed);
}
.detail__next {
  display: flex;
  flex-direction: column;
}
.detail__next > .section-label {
  margin-bottom: var(--space-sm);
}
.detail__progress {
  margin: var(--space-sm) 0 0;
  color: var(--status-confirmed);
  font-weight: 600;
}
.detail__edit-trip {
  margin-top: var(--space-md);
}
.detail__return {
  margin-top: var(--space-md);
}
.detail__trip-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.detail__trip-load {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}
.detail__ended strong {
  font-size: var(--font-body-large);
}
.detail__ended p {
  margin: var(--space-xs) 0 0;
  color: var(--color-text-secondary);
}
.detail__remind {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-card);
  background: var(--color-gold-tint);
}
.detail__remind p {
  display: flex;
  flex-direction: column;
  margin: 0;
  color: var(--color-gold-ink);
  font-weight: 700;
}
.detail__remind small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
/* 行程進度 while there is still time: asked, not urged. */
.detail__remind--calm {
  background: var(--color-tint);
}
.detail__remind--calm p {
  color: var(--color-text);
}
.detail__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}
.detail__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.detail__route {
  margin: var(--space-md) 0;
}
.detail__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
  color: var(--color-label);
  font-size: var(--font-label);
}
.detail__trip-price {
  margin-left: auto;
  color: var(--color-gold-ink);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.detail__line {
  margin: var(--space-sm) 0 0;
  color: var(--color-text-secondary);
}
.detail__note {
  margin: var(--space-md) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.detail__stack {
  display: grid;
  gap: var(--space-sm);
}
.detail__wa {
  display: block;
  margin-top: var(--space-md);
  text-align: center;
  font-size: var(--font-label);
}
/* A thin line between the parts of one card, instead of another box. */
.detail__divided {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-divider);
}
.detail__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  font-weight: 600;
}
.detail__switch > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.detail__switch small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
.detail__stack--whatsapp-first > :first-child {
  order: 1;
}
.detail__link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 40px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.detail__leg-hint {
  margin: 0 0 var(--space-md);
}
.detail__price {
  display: flex;
  flex-direction: column;
}
.detail__price .section-label {
  margin-bottom: 0;
}
.detail__price strong {
  color: var(--color-gold-ink);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.detail__fee {
  margin: var(--space-xs) 0 0;
}
.detail__gap {
  margin-top: var(--space-md);
}
.detail__gap-bottom {
  margin-bottom: var(--space-lg);
}
.detail__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
.detail__person {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.detail__person strong {
  font-size: 20px;
}
.detail__phone {
  display: block;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.detail__waiting {
  margin: 0;
  color: var(--color-gold-ink);
  font-weight: 600;
}
.detail__confirmed {
  margin: var(--space-xs) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.detail__confirmed .chip {
  margin-left: var(--space-sm);
}
.detail__confirmed--yes {
  color: var(--status-confirmed);
  font-weight: 700;
}
.detail__reveal {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.detail__reveal-text {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.detail__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}
.detail__cancel {
  min-height: 44px;
  border: none;
  background: none;
  color: var(--color-error);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.detail__question {
  margin: 0 0 var(--space-sm);
  font-weight: 600;
}
.detail__question + .hint {
  margin: 0 0 var(--space-lg);
}
</style>
