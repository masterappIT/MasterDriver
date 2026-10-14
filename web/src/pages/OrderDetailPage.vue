<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import BottomSheet from '../components/BottomSheet.vue';
import ContactLines from '../components/ContactLines.vue';
import JourneyLegs from '../components/JourneyLegs.vue';
import PlateTag from '../components/PlateTag.vue';
import RevealSelect, { revealLabel } from '../components/RevealSelect.vue';
import RoutePoints from '../components/RoutePoints.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TripGroupJoin, { type TripGroup } from '../components/TripGroupJoin.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import { imageForUpload } from '../image';
import { loadLine, money, pickup, plateKind, shortTime, type Money } from '../format';
import PageBack from '../components/PageBack.vue';
import AppIcon from '../components/AppIcon.vue';
import GroupText from '../components/GroupText.vue';
import { t } from '../i18n';
import { legLabel, plateRequirement, type Journey, type PlateRegion } from '../journey';
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
  pickupAt: string;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  notes: string | null;
  requiredPlates: PlateRegion[];
  journey: Journey | null;
  dispatcherName: string | null;
  dispatcherPhone?: string;
  /** The dispatcher's 名片頁, when it is public. */
  dispatcherPageCode?: string | null;
  dispatcherContact?: { wechatId: string | null; whatsapp: string | null; phones?: string[] };
  claimedAt: string | null;
  passengerConfirmedAt: string | null;
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
// 接駁 with 這段我自己做 still has another driver on the other leg, so it keeps the full view.
const ownTrip = computed(() => isDispatcher.value && Boolean(order.value?.selfDrive) && !order.value?.journey);
/** 接駁: the passenger's one price for the whole order is kept on, and changed from, the first leg. */
const tripPriceHere = computed(() => !order.value?.journey || order.value.journey.legIndex === 1);
/** A driver is set and the passenger has not confirmed: remind the dispatcher to send the link. */
/** Someone else has the order: the group now needs 已派出, not the order again. */
const taken = computed(() => order.value?.status === 'ASSIGNED' && !selfDriven.value && Boolean(order.value.share?.claimed));
const remindPassenger = computed(
  () => isDispatcher.value && order.value?.status === 'ASSIGNED' && !order.value.passengerConfirmedAt && !order.value.fromBooking,
);

/** 接駁 is cancelled whole; one leg's driver is replaced with 改派 instead. */
const cancelQuestion = computed(() =>
  order.value?.journey ? '確定取消整張接駁單？兩段都會取消。只想換其中一段的司機，請用「改派」。' : '確定取消這張單？',
);

async function load() {
  try {
    order.value = await api<Detail>('GET', `/orders/${id.value}`);
    error.value = '';
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
  if (!o || !isDispatcher.value || o.paidAt || o.status === 'CANCELLED' || o.status === 'OPEN') return false;
  return o.status === 'COMPLETED' || new Date(o.pickupAt).getTime() <= Date.now();
});

/** 已結清: only once the trip is done, and only when someone else drove it. */
const canSettle = computed(() => order.value?.status === 'COMPLETED' && !order.value.selfDrive);

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
  prices.currency = o.driverPrice?.currency ?? o.passengerPrice?.currency ?? 'HKD';
  prices.passengerCurrency = o.passengerPrice?.currency ?? prices.currency;
  prices.driver = o.driverPrice ? String(o.driverPrice.amount) : '';
  // 自己做 shows one price, the driver price when no passenger price was set; editing keeps that figure.
  const passenger = o.passengerPrice ?? (ownTrip.value ? o.driverPrice : null);
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
  const body: Record<string, unknown> = tripPriceHere.value ? { passengerPrice: money(prices.passenger, prices.passengerCurrency) } : {};
  // The driver price (and its currency) is fixed once a driver has taken the order.
  if (order.value?.status === 'OPEN') body.driverPrice = money(prices.driver, prices.currency);
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
  if (document.visibilityState !== 'visible' || busy.value || pending.value || !live.value) return;
  void load();
}

function onVisible() {
  if (document.visibilityState === 'visible') refresh();
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
      <ol v-if="order.status !== 'CANCELLED' && !ownTrip" class="detail__steps" style="order: 1" :aria-label="t('進度')">
        <li class="done">{{ t('已出單') }}</li>
        <li :class="{ done: order.claimedAt }">{{ order.driver?.name ? t(`${order.driver.name} 接單`) : t('有人接') }}</li>
        <li :class="{ done: order.passengerConfirmedAt }">{{ t('乘客確認') }}</li>
      </ol>

      <!-- The moment to send the passenger their link: a driver is set, and the passenger has not confirmed. -->
      <section v-if="remindPayment" class="detail__remind" style="order: 2">
        <p>
          {{ t('乘客付款了嗎？') }}
          <small>{{ t('查過自己的帳戶，收到了就按「已收款」。乘客直接付給你，平台不經手。') }}</small>
        </p>
        <button class="button" type="button" :disabled="busy" @click="setPayment({ paid: true }, '已記為已收款')">{{ t('已收款') }}</button>
      </section>

      <section v-if="isDispatcher && canSettle && !order.settledAt" class="detail__remind" style="order: 2">
        <p>
          {{ t(`和${order.driver?.name ?? '接單司機'}結清了嗎？`) }}
          <small>{{ t('你們自己結，結好了按「已結清」，司機那邊也會看到。平台不經手、不核對。') }}</small>
        </p>
        <button class="button" type="button" :disabled="busy" @click="setSettled(true)">{{ t('已結清') }}</button>
      </section>

      <section v-if="remindPassenger && order.share" class="detail__remind" style="order: 2">
        <p>
          {{ selfDriven ? t('這單你自己做，把確認連結傳給乘客') : t(`${order.driver?.name ?? '司機'} 接了這張單，把確認連結傳給乘客`) }}
          <small>{{ t('乘客會看到司機和車牌，按一下就確認行程') }}</small>
        </p>
        <button class="button" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
          <AppIcon name="copy" :size="18" />{{ t('複製給乘客') }}
        </button>
      </section>

      <!-- The trip in the order of the group text: time, route, load, then what must be noticed. -->
      <section class="card" style="order: 3">
        <div class="detail__top">
          <strong class="detail__time">{{ pickup(order.pickupAt) }}</strong>
          <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
        </div>
        <div class="detail__route"><RoutePoints :origin="order.origin" :destination="order.destination" :waypoints="order.waypoints" /></div>
        <div class="detail__meta">
          <span>{{ t(loadLine(order.passengers, order.luggage, order.vehicleType)) }}</span>
          <span v-if="order.journey" class="leg-tag">{{ t(`接駁 ${legLabel(order.journey)}`) }}</span>
          <span v-if="order.requiredPlates.length" class="gold-tag">{{ t(plateRequirement(order.requiredPlates)) }}</span>
        </div>
        <p v-if="order.journey" class="detail__line">{{ t(`在 ${order.journey.transferPlaces.join('、')} 換車`) }}</p>
        <p v-if="order.notes" class="detail__note">{{ t(order.notes) }}</p>
      </section>

      <!-- 接駁: both legs of the order; the dispatcher opens a leg to manage its driver. -->
      <section v-if="order.journey" class="card" style="order: 5">
        <span class="section-label">{{ isDispatcher ? t('整張接駁單（兩段），點一段管理它的司機') : t('整張接駁單（兩段）') }}</span>
        <JourneyLegs :legs="order.journey.legs" :current="order.journey.legIndex" />
      </section>

      <!-- The passenger: after the group text while waiting for a driver, after the driver once taken. -->
      <section class="card" style="order: 10">
        <span class="section-label">{{ order.passengerName ? t(order.passengerName) : t('乘客') }}</span>
        <strong v-if="order.passengerContact" class="detail__phone">{{ order.passengerContact }}</strong>
        <p v-else-if="order.contactEnded" class="detail__waiting">{{ t('行程已結束，乘客電話不再顯示。有需要請聯絡出單者。') }}</p>
        <p v-else class="detail__waiting">{{ t(`乘客電話 ${shortTime(order.contactRevealAt)} 顯示。之前如需安排，請聯絡出單者。`) }}</p>
        <p class="detail__confirmed" :class="{ 'detail__confirmed--yes': order.passengerConfirmedAt }">
          {{ order.passengerConfirmedAt ? t(`乘客 ${shortTime(order.passengerConfirmedAt)} 確認了行程`) : t('乘客還沒確認') }}
        </p>
        <div v-if="order.passengerContact" class="detail__pair detail__gap">
          <a class="button secondary" :href="`tel:${order.passengerContact.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電乘客') }}</a>
          <button class="button secondary" type="button" @click="copy(order.passengerContact, '已複製')">{{ t('複製號碼') }}</button>
        </div>
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
      </section>

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
          <label v-if="live" class="detail__switch">
            <span>{{ t('乘客確認頁顯示價錢') }}</span>
            <input
              class="switch"
              type="checkbox"
              :checked="order.showPassengerPrice"
              :disabled="busy"
              @change="patchPrices({ showPassengerPrice: !order.showPassengerPrice }, '已更新')"
            />
          </label>
          <label class="detail__switch detail__divided">
            <span>
              {{ t('乘客確認頁顯示收款方式') }}
              <small>{{ order.journey ? t('整張接駁單一起顯示，乘客付一次') : t('顯示時會一併顯示價錢') }}</small>
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
            {{ order.journey ? t(`平台服務費 HK$${order.serviceFee}，整張接駁單只收一次，取消會退回`) : t(`平台服務費 HK$${order.serviceFee}，取消會退回`) }}
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
        <div class="detail__divided">
          <span class="section-label">{{ t('傳給乘客') }}</span>
          <button class="detail__link" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製給乘客的確認訊息') }}
          </button>
        </div>
      </section>

      <!-- Prices: the dispatcher sees both and the spread; the driver only the driver price -->
      <section class="card" style="order: 12">
        <!-- 自己做: one price, what the passenger pays, and whether it came in. -->
        <template v-if="ownTrip && !editingPrices">
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
              {{ t(`乘客價 ${money(order.passengerPrice) || '未填'}`) }}<template v-if="order.margin">{{ t(`，差價 ${money(order.margin)}`) }}</template>
            </p>
            <p v-else class="detail__line">{{ t('乘客價整張單一個，在第 1 段查看和修改') }}</p>
            <p v-if="order.serviceFee" class="hint detail__fee">
              {{ order.journey ? t(`平台服務費 HK$${order.serviceFee}，整張接駁單只收一次，取消會退回`) : t(`平台服務費 HK$${order.serviceFee}，取消會退回`) }}
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
              <button class="button secondary block detail__gap" type="button" @click="editPrices">{{ t('修改價格') }}</button>
            </template>
          </template>
        </template>
        <form v-if="editingPrices" @submit.prevent="savePrices">
          <template v-if="!ownTrip">
            <span class="section-label">{{ order.status === 'OPEN' ? t('出單價') : t('出單價（已有司機接單，不能再改）') }}</span>
            <div class="amount-line detail__gap-bottom">
              <select v-model="prices.currency" :aria-label="t('出單價幣種')" :disabled="order.status !== 'OPEN'">
                <option value="HKD">HK$</option>
                <option value="CNY">RMB¥</option>
                <option value="MOP">MOP$</option>
              </select>
              <input v-model="prices.driver" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('出單價')" :disabled="order.status !== 'OPEN'" />
            </div>
          </template>
          <span v-if="tripPriceHere" class="section-label">{{ ownTrip ? t('價錢') : order.journey ? t('乘客價（整張單一個價），只有你看得到') : t('乘客價，只有你看得到') }}</span>
          <div v-if="tripPriceHere" class="amount-line amount-line--quiet detail__gap-bottom">
            <select v-model="prices.passengerCurrency" :aria-label="t('乘客價幣種')">
              <option value="HKD">HK$</option>
              <option value="CNY">RMB¥</option>
              <option value="MOP">MOP$</option>
            </select>
            <input v-model="prices.passenger" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('乘客價')" :placeholder="t('乘客價（選填）')" />
          </div>
          <div class="detail__pair">
            <button class="button secondary" type="button" @click="editingPrices = false">{{ t('取消') }}</button>
            <button class="button" type="submit" :disabled="busy">{{ t('儲存') }}</button>
          </div>
        </form>
      </section>

      <!-- 收款與結清: the dispatcher's own marks, apart from the prices. The platform takes no money and checks nothing. -->
      <section v-if="((isDispatcher && order.status !== 'CANCELLED') || canSettle) && !ownTrip" class="card detail__money" style="order: 13">
        <span class="section-label">{{ isDispatcher ? t('收款與結清') : t('結清') }}</span>
        <!-- 收款: the dispatcher's own mark, after checking their account. -->
        <div v-if="isDispatcher && order.status !== 'CANCELLED'" class="detail__paid detail__divided">
          <span class="detail__paid-state" :class="{ 'detail__paid-state--yes': order.paidAt }">
            {{ order.paidAt ? t(`${shortTime(order.paidAt)} 已收款`) : t('未收款') }}
          </span>
          <button class="chip" type="button" :disabled="busy" @click="setPayment({ paid: !order.paidAt }, order.paidAt ? '已改回未收款' : '已記為已收款')">
            {{ order.paidAt ? t('改回未收款') : t('標記已收款') }}
          </button>
        </div>
        <label v-if="isDispatcher && order.status !== 'CANCELLED'" class="detail__switch detail__divided">
          <span>
            {{ t('乘客確認頁顯示收款方式') }}
            <small>{{ order.journey ? t('整張接駁單一起顯示，乘客付一次') : t('顯示時會一併顯示乘客價') }}</small>
          </span>
          <input
            class="switch"
            type="checkbox"
            :checked="order.showPaymentMethods"
            :disabled="busy"
            @change="setPayment({ showPaymentMethods: !order.showPaymentMethods }, '已更新')"
          />
        </label>
        <!-- 已結清: the dispatcher's own mark; the driver sees it. No amount, and the platform does not check it. -->
        <div v-if="canSettle" class="detail__paid detail__divided">
          <span class="detail__settle">
            <span class="detail__paid-state" :class="{ 'detail__paid-state--yes': order.settledAt }">
              {{ order.settledAt ? t(`${shortTime(order.settledAt)} 已結清`) : t('未結清') }}
            </span>
            <small>{{ isDispatcher ? t('和接單司機的帳，你們自己結，平台不經手') : t('和出單者的帳，由出單者標記，平台不經手') }}</small>
          </span>
          <button v-if="isDispatcher" class="chip" type="button" :disabled="busy" @click="setSettled(!order.settledAt)">
            {{ order.settledAt ? t('改回未結清') : t('標記已結清') }}
          </button>
        </div>
      </section>

      <section v-if="order.driver && !ownTrip" class="card" style="order: 7">
        <span class="section-label">{{ selfDriven ? t('這單你自己做') : isDispatcher ? t('接單司機') : t('你的車') }}</span>
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

      <!-- The driver who took the order: how to reach whoever put it out. -->
      <section v-if="!isDispatcher && order.dispatcherPhone" class="card" style="order: 9">
        <span class="section-label">{{ t('出單者') }}</span>
        <div class="detail__person">
          <strong>{{ order.dispatcherName ? t(order.dispatcherName) : t('沒有留名') }}</strong>
          <span class="hint">{{ order.dispatcherPhone }}</span>
        </div>
        <div class="detail__pair detail__gap">
          <a class="button secondary" :href="`tel:${order.dispatcherPhone.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電出單者') }}</a>
          <button class="button secondary" type="button" @click="copy(order.dispatcherPhone, '已複製號碼')">{{ t('複製號碼') }}</button>
        </div>
        <ContactLines class="detail__gap" :phones="order.dispatcherContact?.phones?.slice(1)" :wechat-id="order.dispatcherContact?.wechatId" :whatsapp="order.dispatcherContact?.whatsapp" />
        <RouterLink v-if="order.dispatcherPageCode" class="button secondary block detail__gap" :to="`/p/${order.dispatcherPageCode}`">{{ t('看出單者的名片') }}</RouterLink>
      </section>

      <!-- What can still be done, least drastic first; cancelling is a quiet red link. -->
      <section v-if="live" class="detail__actions" style="order: 20">
        <button v-if="order.status === 'ASSIGNED'" class="button block large" type="button" :disabled="busy" @click="ask('complete', '已完成', '確定這趟行程已完成？', '標記完成')">{{ t('標記完成') }}</button>
        <template v-if="isDispatcher">
          <button
            v-if="order.status === 'ASSIGNED'"
            class="button secondary block"
            type="button"
            :disabled="busy"
            @click="
              selfDriven
                ? ask('reopen', '已重新開放搶單', '把這單放到群裡讓別的司機搶？', '交給別的司機')
                : ask('reopen', '已重新開放搶單', '收回這張單，重新讓司機搶？', '改派', '原本接單的司機打開連結會看到單已改派，請另外通知他。')
            "
          >
            {{ selfDriven ? t('交給別的司機') : t('改派') }}
          </button>
          <button class="detail__cancel" type="button" :disabled="busy" @click="ask('cancel', '已取消', cancelQuestion, order.journey ? '取消整張接駁單' : '取消這張單', cancelNote)">
            {{ order.journey ? t('取消整張接駁單') : t('取消這張單') }}
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
              order.journey ? `確定不做第 ${order.journey.legIndex} 段？只退出你這一段，另一段不受影響。` : '確定不做這張單？',
              '取消接單',
              '這單會回到等人搶，群裡同一個連結可以再搶；出單者會收到通知，最好也直接告訴出單者。',
            )
          "
        >
          {{ t('取消接單') }}
        </button>
      </section>

      <BottomSheet v-if="pending" :title="t(pending.label)" @close="pending = null">
        <p class="detail__question">{{ t(pending.question) }}</p>
        <p v-if="pending.note" class="hint">{{ t(pending.note) }}</p>
        <div class="detail__pair">
          <button class="button secondary" type="button" @click="pending = null">{{ t('先不要') }}</button>
          <button class="button" type="button" :disabled="busy" @click="confirmPending">{{ t(pending.label) }}</button>
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
