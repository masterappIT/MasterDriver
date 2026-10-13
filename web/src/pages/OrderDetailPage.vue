<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import BottomSheet from '../components/BottomSheet.vue';
import JourneyLegs from '../components/JourneyLegs.vue';
import PlateTag from '../components/PlateTag.vue';
import RevealSelect, { revealLabel } from '../components/RevealSelect.vue';
import RoutePoints from '../components/RoutePoints.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import { money, pickup, shortTime, type Money } from '../format';
import PageBack from '../components/PageBack.vue';
import AppIcon from '../components/AppIcon.vue';
import { t } from '../i18n';
import { MAX_JOURNEY_LEGS, legLabel, plateRequirement, type Journey, type PlateRegion } from '../journey';
import { toast } from '../toast';

interface Driver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  vehicleType: string | null;
  color: string | null;
  phone: string;
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
  claimedAt: string | null;
  passengerConfirmedAt: string | null;
  viewer: 'dispatcher' | 'driver';
  passengerName: string | null;
  passengerContact: string | null;
  contactRevealAt: string | null;
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
  links?: { dispatch: string; passengerConfirm: string };
  share?: { dispatch: { wechat: string; whatsapp: string }; claimed: string | null; passenger: string };
}

const route = useRoute();
// Legs of one trip link to each other on this same page, so follow the route.
const id = computed(() => String(route.params.id));
const order = ref<Detail | null>(null);
const error = ref('');
const busy = ref(false);
const editingPrices = ref(false);
const prices = reactive({ currency: 'HKD', driver: '', passenger: '' });

const isDispatcher = computed(() => order.value?.viewer === 'dispatcher');
const live = computed(() => order.value?.status === 'OPEN' || order.value?.status === 'ASSIGNED');
const selfDriven = computed(() => Boolean(order.value?.selfDrive) && order.value?.status === 'ASSIGNED');

/** 接駁: a leg can be added after the last leg of a trip, up to the limit. */
const canAddLeg = computed(() => {
  const o = order.value;
  if (!o || !isDispatcher.value || !live.value) return false;
  return !o.journey || (o.journey.legIndex === o.journey.legCount && o.journey.legCount < MAX_JOURNEY_LEGS);
});
/** Other legs still on: cancelling this one does not cancel them. */
const otherLiveLegs = computed(() =>
  (order.value?.journey?.legs ?? []).filter(
    (leg) => leg.legIndex !== order.value?.journey?.legIndex && (leg.status === 'OPEN' || leg.status === 'ASSIGNED'),
  ),
);
const cancelQuestion = computed(() =>
  otherLiveLegs.value.length > 0 ? '確定取消這一段？接駁的其他段不會自動取消，需要的話請逐段取消。' : '確定取消這張單？',
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
    o.serviceFee ? (o.journey ? '平台服務費整個接駁行程只收一次，全部段都取消才退回。' : '平台服務費會退回。') : null,
    o.status === 'ASSIGNED' && !selfDriven.value ? '已接單的司機打開連結會看到已取消，請另外通知他。' : null,
  ].filter(Boolean);
  return lines.length ? lines.join('') : null;
});

function ask(path: string, done: string, question: string, label: string, note: string | null = null) {
  pending.value = { path, done, question, note, label };
}

async function confirmPending() {
  const action = pending.value;
  pending.value = null;
  if (action) await act(action.path, action.done);
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
  prices.driver = o.driverPrice ? String(o.driverPrice.amount) : '';
  prices.passenger = o.passengerPrice ? String(o.passengerPrice.amount) : '';
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
  const money = (value: string) => (value ? { amount: Number(value), currency: prices.currency } : null);
  const body: Record<string, unknown> = { passengerPrice: money(prices.passenger) };
  // The driver price is fixed once a driver has taken the order.
  if (order.value?.status === 'OPEN') body.driverPrice = money(prices.driver);
  return patchPrices(body, '價格已更新');
}

onMounted(load);
watch(id, () => {
  order.value = null;
  editingPrices.value = false;
  editingReveal.value = false;
  void load();
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('單詳情')" fallback="/app/orders" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="order">
      <!-- Where the order stands: 已出單, 有人接, 乘客確認. -->
      <ol v-if="order.status !== 'CANCELLED'" class="detail__steps" :aria-label="t('進度')">
        <li class="done">{{ t('已出單') }}</li>
        <li :class="{ done: order.claimedAt }">{{ order.driver?.name ? t(`${order.driver.name} 接單`) : t('有人接') }}</li>
        <li :class="{ done: order.passengerConfirmedAt }">{{ t('乘客確認') }}</li>
      </ol>

      <section class="card">
        <div class="detail__top">
          <strong>
            {{ pickup(order.pickupAt) }}
            <span v-if="order.journey" class="leg-tag">{{ t(`接駁 ${legLabel(order.journey)}`) }}</span>
          </strong>
          <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
        </div>
        <div class="detail__route"><RoutePoints :origin="order.origin" :destination="order.destination" /></div>
        <p v-if="order.journey" class="muted">{{ t(`接駁位置：${order.journey.transferPlaces.join('、')}`) }}</p>
        <p v-if="order.requiredPlates.length" class="muted">{{ t(plateRequirement(order.requiredPlates)) }}</p>
        <p v-if="order.waypoints.length" class="muted">{{ t(`途經：${order.waypoints.join('、')}`) }}</p>
        <p class="muted">
          {{ t(`${order.passengers}人・${order.luggage}件行李`) }}<template v-if="order.vehicleType">・{{ t(order.vehicleType) }}</template>
        </p>
        <p v-if="order.notes">{{ t(`備註：${order.notes}`) }}</p>
      </section>

      <div v-if="order.status === 'CANCELLED' && otherLiveLegs.length" class="notice">
        {{ t('這一段已取消，接駁的其他段仍在進行。需要的話，請在下面打開該段取消。') }}
      </div>

      <!-- 接駁: every leg of the trip -->
      <section v-if="order.journey" class="card">
        <h2>{{ t(`接駁行程（${order.journey.legCount} 段）`) }}</h2>
        <JourneyLegs :legs="order.journey.legs" :current="order.journey.legIndex" />
        <RouterLink v-if="canAddLeg" class="button secondary block detail__gap" :to="`/app/new?after=${order.id}`"><AppIcon name="add" :size="18" />{{ t('加接駁段') }}</RouterLink>
      </section>
      <section v-else-if="canAddLeg" class="card">
        <p class="hint detail__leg-hint">{{ t('乘客中途要換車？加一段接駁，另外派給下一段的司機。乘客自行過關不算接駁，下一程請另外出單。') }}</p>
        <RouterLink class="button secondary block" :to="`/app/new?after=${order.id}`"><AppIcon name="add" :size="18" />{{ t('加接駁段') }}</RouterLink>
      </section>

      <!-- Dispatcher: texts to paste into groups and to the passenger -->
      <section v-if="isDispatcher && order.share && live" class="card">
        <template v-if="!selfDriven">
          <h2>{{ t('要貼的文字') }}</h2>
          <pre class="detail__share">{{ t(order.share.dispatch.wechat) }}</pre>
          <div class="detail__pair detail__pair--stack">
            <button class="button" type="button" @click="copy(order.share.dispatch.wechat, '已複製，貼到微信群吧')">{{ t('複製到微信群') }}</button>
            <button class="button" type="button" @click="copy(order.share.dispatch.whatsapp, '已複製，貼到 WhatsApp 群吧')">{{ t('複製到 WhatsApp') }}</button>
          </div>
          <a v-if="!inWeChat" class="detail__wa" :href="whatsappLink(t(order.share.dispatch.whatsapp))" target="_blank" rel="noopener">
            {{ t('直接用 WhatsApp 傳送') }}
          </a>
          <div v-if="order.status === 'OPEN'" class="detail__gap">
            <p class="hint">
              {{ order.inPool ? t('這張單也在接單池，所有登入的司機都看得到並可以搶。') : t('這張單只有拿到連結的人看得到。') }}
            </p>
            <button class="button secondary block" type="button" :disabled="busy" @click="setPool(!order.inPool)">
              {{ order.inPool ? t('從接單池取出') : t('同時放到接單池') }}
            </button>
          </div>
        </template>
        <p v-else class="hint">{{ t('這段你自己做，不用貼到群裡。要交給別的司機，按下面的「放到群裡搶」。') }}</p>
        <button class="button secondary block detail__gap" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
          {{ t('複製給乘客的確認訊息') }}
        </button>
        <button v-if="order.share.claimed && !selfDriven" class="button secondary block detail__gap" type="button" @click="copy(order.share.claimed, '已複製，貼回群裡吧')">
          {{ t('複製「已派出」訊息貼回群') }}
        </button>
      </section>

      <!-- Prices: the dispatcher sees both and the spread; the driver only the driver price -->
      <section class="card">
        <h2>{{ t('價格') }}</h2>
        <template v-if="!editingPrices">
          <p>{{ t('司機價') }}：<strong>{{ money(order.driverPrice) || '—' }}</strong></p>
          <template v-if="isDispatcher">
            <p>{{ t('乘客價') }}：<strong>{{ money(order.passengerPrice) || '—' }}</strong>　<span class="hint">{{ order.showPassengerPrice ? t('乘客看得到') : t('乘客看不到') }}</span></p>
            <p v-if="order.margin">{{ t('差價') }}：<strong>{{ money(order.margin) }}</strong></p>
            <p v-if="order.serviceFee" class="hint">
              {{ order.journey ? t(`平台服務費 HK$${order.serviceFee}（整個接駁行程只收一次，全部段都取消才退回）`) : t(`平台服務費 HK$${order.serviceFee}（取消會退回）`) }}
            </p>
            <div v-if="live" class="row">
              <button class="button secondary" type="button" @click="editPrices">{{ t('修改價格') }}</button>
              <button class="button secondary" type="button" :disabled="busy" @click="patchPrices({ showPassengerPrice: !order.showPassengerPrice }, '已更新')">
                {{ order.showPassengerPrice ? t('不讓乘客看到價格') : t('讓乘客看到價格') }}
              </button>
            </div>
          </template>
        </template>
        <form v-else @submit.prevent="savePrices">
          <label class="field">
            {{ t('幣種') }}
            <select v-model="prices.currency" class="select">
              <option value="HKD">HK$</option>
              <option value="CNY">RMB¥</option>
              <option value="MOP">MOP$</option>
            </select>
          </label>
          <label class="field">
            {{ t('司機價') }}
            <input v-model="prices.driver" class="input" type="number" min="0" step="0.01" :disabled="order.status !== 'OPEN'" />
            <span v-if="order.status !== 'OPEN'" class="hint">{{ t('已有司機接單，司機價不能再改') }}</span>
          </label>
          <label class="field">{{ t('乘客價') }}<input v-model="prices.passenger" class="input" type="number" min="0" step="0.01" /></label>
          <div class="row">
            <button class="button" type="submit" :disabled="busy">{{ t('儲存') }}</button>
            <button class="button secondary" type="button" @click="editingPrices = false">{{ t('取消') }}</button>
          </div>
        </form>
      </section>

      <section v-if="order.driver" class="card">
        <h2>{{ selfDriven ? t('這段你自己做') : isDispatcher ? t('接單司機') : t('你的車') }}</h2>
        <p><strong>{{ order.driver.name ? t(order.driver.name) : '—' }}</strong>　<span class="hint">{{ t(`${shortTime(order.claimedAt)} 搶到`) }}</span></p>
        <PlateTag :hk="order.driver.hkPlate" :macau="order.driver.macauPlate" :mainland="order.driver.mainlandPlate" />
        <div v-if="isDispatcher && !selfDriven" class="row detail__gap">
          <a class="button secondary" :href="`tel:${order.driver.phone.replace(/\s/g, '')}`">{{ t('致電司機') }}</a>
          <button class="button secondary" type="button" @click="copy(order.driver.phone, '已複製號碼')">{{ t('複製號碼') }}</button>
        </div>
      </section>

      <section class="card">
        <h2>{{ t('乘客') }}</h2>
        <p v-if="order.passengerContact">{{ order.passengerName ? t(order.passengerName) : t('乘客') }}：<strong>{{ order.passengerContact }}</strong></p>
        <p v-else class="notice">{{ t(`乘客電話將於 ${shortTime(order.contactRevealAt)} 顯示。之前如需安排，請聯絡出單者。`) }}</p>
        <div v-if="isDispatcher" class="detail__reveal">
          <template v-if="!editingReveal">
            <span class="hint">{{ t(`接單司機看到乘客電話：${revealLabel(order.contactRevealMinutes ?? null)}`) }}</span>
            <button v-if="live" class="chip" type="button" @click="editReveal">{{ t('修改') }}</button>
          </template>
          <template v-else>
            <RevealSelect v-model="reveal" />
            <div class="row">
              <button class="button" type="button" :disabled="busy" @click="saveReveal">{{ t('儲存') }}</button>
              <button class="button secondary" type="button" @click="editingReveal = false">{{ t('取消') }}</button>
            </div>
          </template>
        </div>
        <p class="hint">
          {{ order.passengerConfirmedAt ? t(`乘客已於 ${shortTime(order.passengerConfirmedAt)} 確認行程`) : t('乘客尚未確認') }}
        </p>
        <div v-if="order.passengerContact" class="row">
          <a class="button secondary" :href="`tel:${order.passengerContact.replace(/\s/g, '')}`">{{ t('致電乘客') }}</a>
          <button class="button secondary" type="button" @click="copy(order.passengerContact, '已複製')">{{ t('複製') }}</button>
        </div>
      </section>

      <section v-if="live" class="card row">
        <button v-if="order.status === 'ASSIGNED'" class="button" type="button" :disabled="busy" @click="ask('complete', '已完成', '確定這趟行程已完成？', '標記完成')">{{ t('標記完成') }}</button>
        <template v-if="isDispatcher">
          <button
            v-if="order.status === 'ASSIGNED'"
            class="button secondary"
            type="button"
            :disabled="busy"
            @click="
              selfDriven
                ? ask('reopen', '已重新開放搶單', '把這段放到群裡讓司機搶？', '放到群裡搶')
                : ask('reopen', '已重新開放搶單', '收回這張單，重新讓司機搶？', '改派', '原本接單的司機打開連結會看到單已改派，請另外通知他。')
            "
          >
            {{ selfDriven ? t('放到群裡搶') : t('改派') }}
          </button>
          <button class="button secondary" type="button" :disabled="busy" @click="ask('cancel', '已取消', cancelQuestion, order.journey ? '取消這一段' : '取消這張單', cancelNote)">
            {{ order.journey ? t('取消這一段') : t('取消這張單') }}
          </button>
        </template>
      </section>

      <BottomSheet v-if="pending" :title="t(pending.label)" @close="pending = null">
        <p class="detail__question">{{ t(pending.question) }}</p>
        <p v-if="pending.note" class="hint">{{ t(pending.note) }}</p>
        <div class="detail__pair">
          <button class="button secondary" type="button" @click="pending = null">{{ t('先不要') }}</button>
          <button class="button" type="button" :disabled="busy" @click="confirmPending">{{ t(pending.label) }}</button>
        </div>
      </BottomSheet>
    </template>
  </div>
</template>

<style scoped>
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
.detail__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
/* The two copy buttons get a full row each so "複製到 WhatsApp" never wraps. */
.detail__pair--stack {
  grid-template-columns: 1fr;
}
.detail__wa {
  display: block;
  margin-top: var(--space-md);
  text-align: center;
  font-size: var(--font-label);
}
.detail__question {
  margin: 0 0 var(--space-sm);
  font-weight: 600;
}
.detail__question + .hint {
  margin: 0 0 var(--space-lg);
}
.detail__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail__route {
  margin: var(--space-md) 0;
}
.detail__share {
  white-space: pre-wrap;
  word-break: break-all;
  font: inherit;
  background: var(--color-background);
  border-radius: var(--radius-input);
  padding: var(--space-md);
  margin: 0 0 var(--space-md);
}
.detail__reveal {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-md);
}
.detail__gap {
  margin-top: var(--space-sm);
}
.detail__leg-hint {
  margin: 0 0 var(--space-sm);
}
</style>
