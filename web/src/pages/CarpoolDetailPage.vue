<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import { SEAT_STATUS, carpoolLabel, carpoolTone, partyRoute, type DriverCarpool, type DriverSeat } from '../carpool';
import BottomSheet from '../components/BottomSheet.vue';
import GroupText from '../components/GroupText.vue';
import PageBack from '../components/PageBack.vue';
import TonePill from '../components/TonePill.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import { fromLocalInput, loadLine, money, pickup, shortTime, toLocalInput } from '../format';
import { t } from '../i18n';
import { toast } from '../toast';

/**
 * One carpool as its driver runs it: the text and link to send passengers, the seats asked for
 * (answer those waiting), changes, stopping, and making it an order to drive or put out.
 */
const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const justMade = route.query.new === '1';
const carpool = ref<DriverCarpool | null>(null);
const error = ref('');
const busy = ref(false);

const editable = computed(() => carpool.value?.status === 'OPEN' || carpool.value?.status === 'CLOSED');
const waitingSeats = computed(() => carpool.value?.seatsList.filter((seat) => seat.status === 'PENDING') ?? []);
const confirmedSeats = computed(() => carpool.value?.seatsList.filter((seat) => seat.status === 'CONFIRMED') ?? []);
const pastSeats = computed(() => carpool.value?.seatsList.filter((seat) => seat.status !== 'PENDING' && seat.status !== 'CONFIRMED') ?? []);

async function load() {
  try {
    carpool.value = await api<DriverCarpool>('GET', `/carpools/${id}`);
    error.value = '';
  } catch (e) {
    if (!carpool.value) error.value = errorText(e);
  }
}

async function act(path: string, done: string, question?: string) {
  if (question && !confirm(t(question))) return;
  busy.value = true;
  try {
    carpool.value = await api<DriverCarpool>('POST', `/carpools/${id}/${path}`);
    toast(done);
  } catch (e) {
    toast(errorText(e));
    await load();
  } finally {
    busy.value = false;
  }
}

const seatAction = (seat: DriverSeat, action: 'confirm' | 'decline' | 'remove') =>
  act(
    `seats/${seat.id}/${action}`,
    { confirm: '已確認', decline: '已婉拒', remove: '已取消這組' }[action],
    action === 'remove' ? `確定取消 ${seat.passengerName} 這組（${seat.passengers} 位）？請另外通知乘客。` : undefined,
  );

async function copy(text: string, done: string) {
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

// ------------------------------------------------------------------ 修改

const editing = ref(false);
const form = reactive({
  pickupAt: '',
  closesAt: '',
  seats: '',
  minPassengers: '',
  currency: 'HKD',
  seatPrice: '',
  luggagePerSeat: '',
  waitMinutes: '',
  autoConfirm: false,
  showPaymentMethods: false,
  cancelPolicy: '',
  notes: '',
});

function edit() {
  const c = carpool.value;
  if (!c) return;
  Object.assign(form, {
    pickupAt: toLocalInput(new Date(c.pickupAt)),
    closesAt: toLocalInput(new Date(c.closesAt)),
    seats: String(c.seats),
    minPassengers: c.minPassengers === null ? '' : String(c.minPassengers),
    currency: c.seatPrice?.currency ?? 'HKD',
    seatPrice: c.seatPrice ? String(c.seatPrice.amount) : '',
    luggagePerSeat: c.luggagePerSeat === null ? '' : String(c.luggagePerSeat),
    waitMinutes: String(c.waitMinutes),
    autoConfirm: c.autoConfirm,
    showPaymentMethods: c.showPaymentMethods,
    cancelPolicy: c.cancelPolicy ?? '',
    notes: c.notes ?? '',
  });
  editing.value = true;
}

/** Only what changed is sent: a new time or price asks every party to accept it again. */
async function save() {
  const c = carpool.value;
  if (!c) return;
  const body: Record<string, unknown> = {};
  const pickupAt = fromLocalInput(form.pickupAt);
  if (new Date(pickupAt).getTime() !== new Date(c.pickupAt).getTime()) body.pickupAt = pickupAt;
  const closesAt = fromLocalInput(form.closesAt);
  if (new Date(closesAt).getTime() !== new Date(c.closesAt).getTime()) body.closesAt = closesAt;
  if (Number(form.seats) !== c.seats) body.seats = Number(form.seats);
  const min = form.minPassengers === '' ? null : Number(form.minPassengers);
  if (min !== c.minPassengers) body.minPassengers = min;
  const price = form.seatPrice === '' ? null : { amount: Number(form.seatPrice), currency: form.currency };
  if (JSON.stringify(price) !== JSON.stringify(c.seatPrice ?? null)) body.seatPrice = price;
  const luggage = form.luggagePerSeat === '' ? null : Number(form.luggagePerSeat);
  if (luggage !== c.luggagePerSeat) body.luggagePerSeat = luggage;
  if (Number(form.waitMinutes) !== c.waitMinutes) body.waitMinutes = Number(form.waitMinutes);
  if (form.autoConfirm !== c.autoConfirm) body.autoConfirm = form.autoConfirm;
  if (form.showPaymentMethods !== c.showPaymentMethods) body.showPaymentMethods = form.showPaymentMethods;
  if (form.cancelPolicy.trim() !== (c.cancelPolicy ?? '')) body.cancelPolicy = form.cancelPolicy.trim() || null;
  if (form.notes.trim() !== (c.notes ?? '')) body.notes = form.notes.trim() || null;
  if (Object.keys(body).length === 0) {
    editing.value = false;
    return;
  }
  const askAgain = 'pickupAt' in body || 'seatPrice' in body;
  if (askAgain && confirmedSeats.value.length + waitingSeats.value.length > 0 && !confirm(t('改了出發時間或每位價錢，已報位的乘客要在自己的連結上按「接受新的安排」。確定修改？'))) return;
  busy.value = true;
  try {
    carpool.value = await api<DriverCarpool>('PATCH', `/carpools/${id}`, body);
    editing.value = false;
    toast(askAgain ? '已修改，請通知已報位的乘客打開連結接受' : '已修改');
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

// ------------------------------------------------------------------ 成單

const starting = ref<'SELF' | 'DISPATCH' | null>(null);
const dispatch = reactive({ currency: 'HKD', driverPrice: '', vehicleType: '', inPool: false });

function startSheet(mode: 'SELF' | 'DISPATCH') {
  dispatch.vehicleType = session.profile?.vehicleType ?? '';
  starting.value = mode;
}

async function start() {
  const mode = starting.value;
  if (!mode) return;
  busy.value = true;
  try {
    const body =
      mode === 'SELF'
        ? { mode }
        : {
            mode,
            driverPrice: dispatch.driverPrice === '' ? undefined : { amount: Number(dispatch.driverPrice), currency: dispatch.currency },
            vehicleType: dispatch.vehicleType,
            inPool: dispatch.inPool,
          };
    const made = await api<{ orderId: string }>('POST', `/carpools/${id}/start`, body);
    starting.value = null;
    toast(mode === 'SELF' ? '已成單，這趟你自己開' : '已成單，把群文字貼到群裡');
    await router.push(mode === 'SELF' ? `/app/orders/${made.orderId}` : `/app/orders/${made.orderId}/share`);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

/** New seats come in while the driver looks: read again every 15 seconds while it takes seats. */
const REFRESH_MS = 15_000;
let timer: ReturnType<typeof setInterval> | undefined;
function refresh() {
  if (document.visibilityState === 'visible' && !busy.value && !editing.value && !starting.value && editable.value) void load();
}

onMounted(() => {
  void load();
  timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', refresh);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', refresh);
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('拼車')" fallback="/app/carpools" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="carpool">
      <div v-if="justMade && carpool.status === 'OPEN'" class="notice">{{ t('拼車開好了。複製下面的文字和連結，發給乘客。') }}</div>

      <section class="card carpool__trip">
        <TonePill :tone="carpoolTone(carpool)">{{ t(carpoolLabel(carpool)) }}</TonePill>
        <strong class="carpool__time">{{ pickup(carpool.pickupAt) }}</strong>
        <div class="carpool__route">{{ t(`${carpool.origin} 至 ${carpool.destination}`) }}</div>
        <p v-if="carpool.pickupPoints.length" class="carpool__line">{{ t(`上車點：${carpool.pickupPoints.join('、')}`) }}</p>
        <div class="carpool__counts">
          <span><strong>{{ carpool.confirmed }}</strong>{{ t('已確認') }}</span>
          <span><strong>{{ carpool.left }}</strong>{{ t('剩餘座位') }}</span>
          <span><strong>{{ carpool.seats }}</strong>{{ t('座位') }}</span>
        </div>
        <p class="carpool__line">
          {{ t(carpool.seatPrice ? `每位 ${money(carpool.seatPrice)}` : '每位價錢：私訊報價') }}
          <template v-if="carpool.minPassengers">{{ t(`｜滿 ${carpool.minPassengers} 位成行`) }}</template>
        </p>
        <p v-if="editable" class="hint">{{ t(`報位截止 ${shortTime(carpool.closesAt)}｜${carpool.autoConfirm ? '自動確認' : '你逐個確認'}`) }}</p>
      </section>

      <!-- What to do now, by the carpool's stage. -->
      <section v-if="carpool.order" class="card carpool__now">
        <span class="section-label">{{ t('現在要做的事') }}</span>
        <p>{{ t('這趟拼車已成單。行程進度、每組乘客和收款都在訂單裡。') }}</p>
        <RouterLink class="button block" :to="`/app/orders/${carpool.order.id}`">{{ t('打開訂單') }}</RouterLink>
      </section>
      <section v-else-if="carpool.status === 'CANCELLED'" class="card carpool__now">
        <p>{{ t('這趟拼車已取消。已報位的乘客打開連結會看到已取消，最好另外通知他們。') }}</p>
      </section>
      <template v-else>
        <section v-if="waitingSeats.length" class="card carpool__now carpool__now--urgent">
          <strong>{{ t(`${waitingSeats.length} 個報位等你確認`) }}</strong>
          <p class="hint">{{ t('2 小時內沒回覆，報位會失效，座位放回去。') }}</p>
        </section>

        <section v-if="carpool.status === 'OPEN'" class="card">
          <span class="section-label">{{ t('發給乘客') }}</span>
          <GroupText :text="inWeChat ? carpool.share.wechat : carpool.share.whatsapp" :link-note="t('乘客打開這條連結報位，不用註冊')" />
          <div class="carpool__pair">
            <button class="button" type="button" @click="copy(carpool.share.wechat, '已複製，到微信貼上')">{{ t('複製（微信）') }}</button>
            <button class="button outline" type="button" @click="copy(carpool.share.whatsapp, '已複製，到 WhatsApp 貼上')">{{ t('複製（WhatsApp）') }}</button>
          </div>
          <a v-if="!inWeChat" class="carpool__wa" :href="whatsappLink(t(carpool.share.whatsapp))" target="_blank" rel="noopener">{{ t('用 WhatsApp 分享') }}</a>
          <p class="hint">{{ t('有人報位或取消後，剩餘座位會變。再發一次時重新複製，文字會跟著更新。') }}</p>
          <button class="button secondary block carpool__gap" type="button" :disabled="busy" @click="act('close', '已停止報位', '停止報位後，乘客不能再報。確定？')">
            {{ t('停止報位') }}
          </button>
        </section>

        <section v-else class="card">
          <span class="section-label">{{ t('報位已截止') }}</span>
          <p v-if="carpool.short > 0" class="carpool__short">{{ t(`還差 ${carpool.short} 位成行。可以照樣出發、延後截止時間重新開放報位，或取消。`) }}</p>
          <p v-if="carpool.unaccepted" class="hint">{{ t(`${carpool.unaccepted} 組乘客還沒接受新的時間或價錢，接受了才可以成單。`) }}</p>
          <div class="carpool__pair">
            <button class="button" type="button" :disabled="busy || confirmedSeats.length === 0" @click="startSheet('SELF')">{{ t('我自己開') }}</button>
            <button class="button outline" type="button" :disabled="busy || confirmedSeats.length === 0" @click="startSheet('DISPATCH')">{{ t('派出去') }}</button>
          </div>
          <p v-if="confirmedSeats.length === 0" class="hint">{{ t('還沒有已確認的乘客，不能成單。') }}</p>
          <button class="button secondary block carpool__gap" type="button" @click="edit">{{ t('延後截止時間') }}</button>
        </section>
      </template>

      <section v-if="waitingSeats.length" class="card">
        <span class="section-label">{{ t('等你確認') }}</span>
        <article v-for="seat in waitingSeats" :key="seat.id" class="carpool__seat">
          <div class="carpool__seat-top">
            <strong>{{ t(seat.passengerName) }}</strong>
            <span class="carpool__seat-load">{{ t(loadLine(seat.passengers, seat.luggage)) }}</span>
          </div>
          <p class="carpool__line">{{ t(partyRoute(seat, carpool.destination)) }}</p>
          <p v-if="seat.notes" class="carpool__note">{{ t(seat.notes) }}</p>
          <p class="hint">{{ t(`${shortTime(seat.createdAt)} 報位，${seat.expiresAt ? `${shortTime(seat.expiresAt)} 前回覆` : ''}。確認後看得到乘客電話。`) }}</p>
          <div class="carpool__pair">
            <button class="button secondary" type="button" :disabled="busy" @click="seatAction(seat, 'decline')">{{ t('婉拒') }}</button>
            <button class="button" type="button" :disabled="busy" @click="seatAction(seat, 'confirm')">{{ t('確認') }}</button>
          </div>
        </article>
      </section>

      <section class="card">
        <span class="section-label">{{ t(`已確認的乘客（${confirmedSeats.length} 組）`) }}</span>
        <p v-if="confirmedSeats.length === 0" class="hint">{{ t('還沒有。') }}</p>
        <article v-for="seat in confirmedSeats" :key="seat.id" class="carpool__seat">
          <div class="carpool__seat-top">
            <strong>{{ t(seat.passengerName) }}</strong>
            <span class="carpool__seat-load">{{ t(loadLine(seat.passengers, seat.luggage)) }}</span>
          </div>
          <p class="carpool__line">{{ t(partyRoute(seat, carpool.destination)) }}</p>
          <p v-if="seat.price" class="carpool__line">{{ t(`${money(seat.price)}${seat.paidAt ? '｜已收款' : ''}`) }}</p>
          <p v-if="seat.reconfirm" class="carpool__flag">{{ t('還沒接受新的時間或價錢') }}</p>
          <p v-if="seat.notes" class="carpool__note">{{ t(seat.notes) }}</p>
          <div v-if="seat.passengerContact" class="carpool__contact">
            <a class="button secondary" :href="`tel:${seat.passengerContact.replace(/\s/g, '')}`">{{ t('致電') }} {{ seat.passengerContact }}</a>
            <span v-if="seat.passengerWechat" class="hint">{{ t(`微信：${seat.passengerWechat}`) }}</span>
          </div>
          <button v-if="!carpool.order || carpool.order.status === 'OPEN' || carpool.order.status === 'ASSIGNED'" class="carpool__remove" type="button" :disabled="busy" @click="seatAction(seat, 'remove')">
            {{ t('取消這組') }}
          </button>
        </article>
      </section>

      <details v-if="pastSeats.length" class="card carpool__past">
        <summary>{{ t(`其他報位（${pastSeats.length}）`) }}</summary>
        <p v-for="seat in pastSeats" :key="seat.id" class="carpool__line">
          {{ t(`${seat.passengerName}｜${seat.passengers} 位｜${SEAT_STATUS[seat.status].driver}`) }}
        </p>
      </details>

      <section v-if="editable" class="card carpool__more">
        <button class="button secondary block" type="button" @click="edit">{{ t('修改拼車') }}</button>
        <button class="carpool__remove carpool__cancel" type="button" :disabled="busy" @click="act('cancel', '已取消拼車', '確定取消整趟拼車？已報位的乘客會看到已取消，請另外通知他們。')">
          {{ t('取消整趟拼車') }}
        </button>
      </section>

      <BottomSheet v-if="editing" :title="t('修改拼車')" @close="editing = false">
        <form class="carpool__form" @submit.prevent="save">
          <label class="line-field">
            <span>{{ t('出發時間（香港時間）') }}</span>
            <input v-model="form.pickupAt" class="line-input" type="datetime-local" required />
          </label>
          <label class="line-field">
            <span>{{ t('報位截止') }}</span>
            <input v-model="form.closesAt" class="line-input" type="datetime-local" required />
            <small class="hint">{{ t('改到將來的時間，會重新開放報位。') }}</small>
          </label>
          <div class="carpool__pair">
            <label class="line-field">
              <span>{{ t('座位') }}</span>
              <input v-model="form.seats" class="line-input" type="number" min="1" inputmode="numeric" required />
            </label>
            <label class="line-field">
              <span>{{ t('最少成行人數') }}</span>
              <input v-model="form.minPassengers" class="line-input" type="number" min="1" inputmode="numeric" />
            </label>
          </div>
          <div class="line-field">
            <span>{{ t('每位價錢') }}</span>
            <div class="amount-line">
              <select v-model="form.currency" :aria-label="t('幣種')">
                <option value="CNY">RMB¥</option>
                <option value="HKD">HK$</option>
                <option value="MOP">MOP$</option>
              </select>
              <input v-model="form.seatPrice" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('每位價錢')" />
            </div>
          </div>
          <div class="carpool__pair">
            <label class="line-field">
              <span>{{ t('每位行李') }}</span>
              <input v-model="form.luggagePerSeat" class="line-input" type="number" min="0" max="10" inputmode="numeric" />
            </label>
            <label class="line-field">
              <span>{{ t('等候分鐘') }}</span>
              <input v-model="form.waitMinutes" class="line-input" type="number" min="0" max="120" inputmode="numeric" />
            </label>
          </div>
          <label class="carpool__switch">
            <span>{{ t('自動確認報位') }}</span>
            <input v-model="form.autoConfirm" class="switch" type="checkbox" />
          </label>
          <label class="carpool__switch">
            <span>{{ t('乘客連結顯示收款方式') }}</span>
            <input v-model="form.showPaymentMethods" class="switch" type="checkbox" />
          </label>
          <label class="line-field">
            <span>{{ t('取消規則') }}</span>
            <textarea v-model="form.cancelPolicy" class="line-input" maxlength="300" />
          </label>
          <label class="line-field">
            <span>{{ t('備註') }}</span>
            <textarea v-model="form.notes" class="line-input" maxlength="500" />
          </label>
          <button class="button block large" type="submit" :disabled="busy">{{ t('儲存') }}</button>
        </form>
      </BottomSheet>

      <BottomSheet v-if="starting" :title="starting === 'SELF' ? t('自己開這趟拼車') : t('派出去')" @close="starting = null">
        <p class="hint">{{ t(`${confirmedSeats.length} 組、${carpool.confirmed} 位乘客。成單會用一張出單額度，和一般出單一樣。`) }}</p>
        <template v-if="starting === 'SELF'">
          <p>{{ t('成單後在訂單裡回報出發，並逐組按「已到上車點」「已上車」。') }}</p>
        </template>
        <form v-else class="carpool__form" @submit.prevent="start">
          <div class="line-field">
            <span>{{ t('出單價（付給接單司機，選填）') }}</span>
            <div class="amount-line">
              <select v-model="dispatch.currency" :aria-label="t('幣種')">
                <option value="CNY">RMB¥</option>
                <option value="HKD">HK$</option>
                <option value="MOP">MOP$</option>
              </select>
              <input v-model="dispatch.driverPrice" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('出單價')" />
            </div>
          </div>
          <label class="line-field">
            <span>{{ t('車型') }}</span>
            <input v-model="dispatch.vehicleType" class="line-input" maxlength="30" required :placeholder="t('例如：7座')" />
          </label>
          <label class="carpool__switch">
            <span>
              {{ t('同時放到接單池') }}
              <small>{{ t('登入的司機都看得到並可以搶，乘客資料仍只給搶到的司機') }}</small>
            </span>
            <input v-model="dispatch.inPool" class="switch" type="checkbox" />
          </label>
        </form>
        <div class="carpool__pair">
          <button class="button secondary" type="button" @click="starting = null">{{ t('取消') }}</button>
          <button class="button" type="button" :disabled="busy || (starting === 'DISPATCH' && !dispatch.vehicleType.trim())" @click="start">
            {{ starting === 'SELF' ? t('成單，我自己開') : t('成單並取得群文字') }}
          </button>
        </div>
      </BottomSheet>
    </template>
  </div>
</template>

<style scoped>
.carpool__trip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.carpool__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.carpool__route {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.carpool__line {
  margin: 0;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}
.carpool__counts {
  display: flex;
  gap: var(--space-lg);
  margin: var(--space-sm) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.carpool__counts strong {
  display: block;
  color: var(--color-text);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.carpool__now p {
  margin: var(--space-xs) 0 var(--space-md);
}
.carpool__now--urgent {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.carpool__now--urgent p {
  margin: var(--space-xs) 0 0;
}
.carpool__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
.carpool__gap {
  margin-top: var(--space-md);
}
.carpool__wa {
  display: inline-block;
  margin-top: var(--space-sm);
  font-weight: 600;
}
.carpool__short {
  margin: 0 0 var(--space-md);
  color: var(--color-gold-ink);
}
.carpool__seat {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md) 0;
  border-top: 1px solid var(--color-divider);
}
.carpool__seat:first-of-type {
  border-top: none;
}
.carpool__seat-top {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
}
.carpool__seat-load {
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.carpool__note {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.carpool__flag {
  margin: 0;
  color: var(--color-gold-ink);
  font-weight: 700;
}
.carpool__contact {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.carpool__remove {
  align-self: flex-start;
  min-height: 40px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-error);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.carpool__past summary {
  font-weight: 600;
  cursor: pointer;
}
.carpool__past p {
  margin-top: var(--space-sm);
}
.carpool__more {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.carpool__cancel {
  align-self: center;
}
.carpool__form .line-field > small {
  display: block;
  margin-top: var(--space-xs);
}
.carpool__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 48px;
  margin-bottom: var(--space-md);
  font-weight: 600;
}
.carpool__switch > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.carpool__switch small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
</style>
