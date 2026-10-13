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

      <!-- The trip in the order of the group text: time, route, load, then what must be noticed. -->
      <section class="card">
        <div class="detail__top">
          <strong class="detail__time">{{ pickup(order.pickupAt) }}</strong>
          <StatusBadge :status="order.status" :confirmed="Boolean(order.passengerConfirmedAt)" />
        </div>
        <div class="detail__route"><RoutePoints :origin="order.origin" :destination="order.destination" :waypoints="order.waypoints" /></div>
        <div class="detail__meta">
          <span>{{ t([`${order.passengers}人`, `${order.luggage}件行李`, order.vehicleType].filter(Boolean).join('｜')) }}</span>
          <span v-if="order.journey" class="leg-tag">{{ t(`接駁 ${legLabel(order.journey)}`) }}</span>
          <span v-if="order.requiredPlates.length" class="gold-tag">{{ t(plateRequirement(order.requiredPlates)) }}</span>
        </div>
        <p v-if="order.journey" class="detail__line">{{ t(`在 ${order.journey.transferPlaces.join('、')} 換車`) }}</p>
        <p v-if="order.notes" class="detail__note">{{ t(order.notes) }}</p>
      </section>

      <div v-if="order.status === 'CANCELLED' && otherLiveLegs.length" class="notice">
        {{ t('這一段已取消，接駁的其他段仍在進行。需要的話，請在下面打開該段取消。') }}
      </div>

      <!-- 接駁: every leg of the trip -->
      <section v-if="order.journey" class="card">
        <span class="section-label">{{ t(`整個接駁行程，共 ${order.journey.legCount} 段`) }}</span>
        <JourneyLegs :legs="order.journey.legs" :current="order.journey.legIndex" />
        <RouterLink v-if="canAddLeg" class="button secondary block detail__gap" :to="`/app/new?after=${order.id}`"><AppIcon name="add" :size="18" />{{ t('加接駁段') }}</RouterLink>
      </section>

      <section v-else-if="canAddLeg" class="card">
        <p class="detail__line detail__leg-hint">{{ t('乘客中途要換車？加一段接駁，另外派給下一段的司機。乘客自行過關不算接駁，下一程請另外出單。') }}</p>
        <RouterLink class="button secondary block" :to="`/app/new?after=${order.id}`"><AppIcon name="add" :size="18" />{{ t('加接駁段') }}</RouterLink>
      </section>

      <!-- Dispatcher: texts to paste into groups and to the passenger -->
      <section v-if="isDispatcher && order.share && live" class="card">
        <template v-if="!selfDriven">
          <span class="section-label">{{ t('貼到群裡') }}</span>
          <pre class="detail__share">{{ t(order.share.dispatch.wechat) }}</pre>
          <div class="detail__stack">
            <button class="button" type="button" @click="copy(order.share.dispatch.wechat, '已複製，貼到微信群吧')">
              <AppIcon name="copy" :size="18" />{{ t('複製到微信群') }}
            </button>
            <button class="button" type="button" @click="copy(order.share.dispatch.whatsapp, '已複製，貼到 WhatsApp 群吧')">
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
        <p v-else class="detail__line">{{ t('這段你自己做，不用貼到群裡。要交給別的司機，按下面的「放到群裡搶」。') }}</p>
        <div class="detail__links" :class="{ 'detail__divided': !selfDriven }">
          <button class="detail__link" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製給乘客的確認訊息') }}
          </button>
          <button v-if="order.share.claimed && !selfDriven" class="detail__link" type="button" @click="copy(order.share.claimed, '已複製，貼回群裡吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製「已派出」訊息貼回群') }}
          </button>
        </div>
      </section>

      <!-- Prices: the dispatcher sees both and the spread; the driver only the driver price -->
      <section class="card">
        <template v-if="!editingPrices">
          <div class="detail__price">
            <span class="section-label">{{ t('司機價') }}</span>
            <strong>{{ money(order.driverPrice) || t('沒有填') }}</strong>
          </div>
          <template v-if="isDispatcher">
            <p class="detail__line">
              {{ t(`乘客價 ${money(order.passengerPrice) || '沒有填'}`) }}<template v-if="order.margin">{{ t(`，差價 ${money(order.margin)}`) }}</template>
            </p>
            <p v-if="order.serviceFee" class="hint detail__fee">
              {{ order.journey ? t(`平台服務費 HK$${order.serviceFee}，整個接駁行程只收一次，全部段都取消才退回`) : t(`平台服務費 HK$${order.serviceFee}，取消會退回`) }}
            </p>
            <template v-if="live">
              <label class="detail__switch detail__divided">
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
        <form v-else @submit.prevent="savePrices">
          <span class="section-label">{{ order.status === 'OPEN' ? t('司機價') : t('司機價（已有司機接單，不能再改）') }}</span>
          <div class="amount-line detail__gap-bottom">
            <select v-model="prices.currency" :aria-label="t('幣種')">
              <option value="HKD">HK$</option>
              <option value="CNY">RMB¥</option>
              <option value="MOP">MOP$</option>
            </select>
            <input v-model="prices.driver" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('司機價')" :disabled="order.status !== 'OPEN'" />
          </div>
          <label class="line-field">
            <span>{{ t('乘客價，只有你看得到') }}</span>
            <input v-model="prices.passenger" class="line-input" type="number" min="0" step="0.01" inputmode="decimal" />
          </label>
          <div class="detail__pair">
            <button class="button secondary" type="button" @click="editingPrices = false">{{ t('取消') }}</button>
            <button class="button" type="submit" :disabled="busy">{{ t('儲存') }}</button>
          </div>
        </form>
      </section>

      <section v-if="order.driver" class="card">
        <span class="section-label">{{ selfDriven ? t('這段你自己做') : isDispatcher ? t('接單司機') : t('你的車') }}</span>
        <div class="detail__person">
          <strong>{{ order.driver.name ? t(order.driver.name) : t('沒有留名') }}</strong>
          <span class="hint">{{ t(`${shortTime(order.claimedAt)} 搶到`) }}</span>
        </div>
        <PlateTag :hk="order.driver.hkPlate" :macau="order.driver.macauPlate" :mainland="order.driver.mainlandPlate" />
        <div v-if="isDispatcher && !selfDriven" class="detail__pair detail__gap">
          <a class="button secondary" :href="`tel:${order.driver.phone.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電司機') }}</a>
          <button class="button secondary" type="button" @click="copy(order.driver.phone, '已複製號碼')">{{ t('複製號碼') }}</button>
        </div>
      </section>

      <section class="card">
        <span class="section-label">{{ order.passengerName ? t(order.passengerName) : t('乘客') }}</span>
        <strong v-if="order.passengerContact" class="detail__phone">{{ order.passengerContact }}</strong>
        <p v-else class="detail__waiting">{{ t(`乘客電話 ${shortTime(order.contactRevealAt)} 顯示。之前如需安排，請聯絡出單者。`) }}</p>
        <p class="detail__confirmed" :class="{ 'detail__confirmed--yes': order.passengerConfirmedAt }">
          {{ order.passengerConfirmedAt ? t(`乘客 ${shortTime(order.passengerConfirmedAt)} 確認了行程`) : t('乘客還沒確認') }}
        </p>
        <div v-if="order.passengerContact" class="detail__pair detail__gap">
          <a class="button secondary" :href="`tel:${order.passengerContact.replace(/\s/g, '')}`"><AppIcon name="call" :size="18" />{{ t('致電乘客') }}</a>
          <button class="button secondary" type="button" @click="copy(order.passengerContact, '已複製')">{{ t('複製號碼') }}</button>
        </div>
        <div v-if="isDispatcher" class="detail__divided detail__reveal">
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
      </section>

      <!-- What can still be done, least drastic first; cancelling is a quiet red link. -->
      <section v-if="live" class="detail__actions">
        <button v-if="order.status === 'ASSIGNED'" class="button block large" type="button" :disabled="busy" @click="ask('complete', '已完成', '確定這趟行程已完成？', '標記完成')">{{ t('標記完成') }}</button>
        <template v-if="isDispatcher">
          <button
            v-if="order.status === 'ASSIGNED'"
            class="button secondary block"
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
          <button class="detail__cancel" type="button" :disabled="busy" @click="ask('cancel', '已取消', cancelQuestion, order.journey ? '取消這一段' : '取消這張單', cancelNote)">
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
.detail__share {
  margin: 0 0 var(--space-md);
  padding: var(--space-md);
  border-radius: 4px 18px 18px 18px;
  background: var(--color-tint);
  font: inherit;
  font-size: var(--font-label);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
.detail__links {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.detail__links:not(.detail__divided) {
  margin-top: var(--space-md);
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
  font-size: 28px;
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
  font-size: 18px;
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
