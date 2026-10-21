<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import { BOOKING_STATUS } from '../booking';
import { DEAL_STATE, dealLimits, dealTime, type DealBookingLine, type DriverDeal } from '../deal';
import DealCardSheet from '../components/DealCardSheet.vue';
import GroupText from '../components/GroupText.vue';
import PageBack from '../components/PageBack.vue';
import TonePill from '../components/TonePill.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import { loadLine, money, shortTime } from '../format';
import { t } from '../i18n';
import { toast } from '../toast';

/**
 * One 特價車 as its driver runs it: the text, link and picture to send passengers, the bookings
 * (each answered on its own 詢價詳情 page, where making the order accepts that party), changes
 * and 下架.
 */
const route = useRoute();
const id = String(route.params.id);
const justMade = route.query.new === '1';
const deal = ref<DriverDeal | null>(null);
const error = ref('');
const busy = ref(false);
const showCard = ref(false);

/** The party that has it: booked with 自動接受第一組 and not yet an order, or made into one. */
const holder = computed(() => deal.value?.bookings.find((booking) => booking.status === 'ACCEPTED' || booking.status === 'ORDERED') ?? null);
const waiting = computed(() => deal.value?.bookings.filter((booking) => booking.status === 'PENDING') ?? []);
const others = computed(() => deal.value?.bookings.filter((booking) => booking !== holder.value && booking.status !== 'PENDING') ?? []);
/** 下架 is refused once it is an order: the order is cancelled instead. */
const canTakeDown = computed(() => deal.value && deal.value.state !== 'CANCELLED' && holder.value?.status !== 'ORDERED');

const bookingLine = (booking: DealBookingLine) =>
  [booking.passengerName ?? '乘客', loadLine(booking.passengers, booking.luggage), deal.value?.pickupUntil ? shortTime(booking.pickupAt) : null].filter(Boolean).join('｜');

async function load() {
  try {
    deal.value = await api<DriverDeal>('GET', `/deals/${id}`);
    error.value = '';
  } catch (e) {
    if (!deal.value) error.value = errorText(e);
  }
}

async function copy(text: string, done: string) {
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

async function takeDown() {
  const question = waiting.value.length || holder.value ? '下架後乘客不能再預約，還在等的預約會婉拒。確定下架？' : '下架後乘客不能再預約。確定下架？';
  if (!confirm(t(question))) return;
  busy.value = true;
  try {
    deal.value = await api<DriverDeal>('POST', `/deals/${id}/cancel`);
    toast('已下架');
  } catch (e) {
    toast(errorText(e));
    await load();
  } finally {
    busy.value = false;
  }
}

/** Passengers book on their own at any time, so an open deal is read again while on screen. */
const REFRESH_MS = 15_000;
let timer: ReturnType<typeof setInterval> | undefined;
function refresh() {
  if (document.visibilityState === 'visible' && !busy.value && !showCard.value && deal.value?.state === 'OPEN') void load();
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
    <PageBack :title="t('特價車')" fallback="/app/deals" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="deal">
      <div v-if="deal.staffReason" class="notice error">{{ t(`平台已下架這個特價車：${deal.staffReason}`) }}</div>
      <div v-else-if="justMade && deal.state === 'OPEN'" class="notice">{{ t('特價車發好了。複製下面的文字和連結，或做成分享圖，發給乘客。') }}</div>

      <section class="card deal__trip">
        <TonePill :tone="DEAL_STATE[deal.state].tone">{{ t(DEAL_STATE[deal.state].driver) }}</TonePill>
        <strong class="deal__time">{{ t(dealTime(deal)) }}</strong>
        <div class="deal__route">{{ t(`${deal.origin} 至 ${deal.destination}`) }}</div>
        <p class="deal__price">
          <strong>{{ t(`整車 ${money(deal.price)}`) }}</strong>
          <s v-if="deal.originalPrice">{{ t(`原價 ${money(deal.originalPrice)}`) }}</s>
        </p>
        <p v-if="dealLimits(deal)" class="deal__line">{{ t(dealLimits(deal)) }}</p>
        <p v-if="deal.notes" class="deal__note">{{ t(deal.notes) }}</p>
        <p class="hint">{{ t(deal.autoAccept ? '自動接受第一組' : '乘客預約後由你確認') }}<template v-if="deal.pickupUntil">{{ t('｜乘客在時段內選出發時間') }}</template></p>
      </section>

      <!-- What to do now, by the deal's stage. -->
      <section v-if="holder" class="card deal__now">
        <span class="section-label">{{ t('現在要做的事') }}</span>
        <template v-if="holder.status === 'ORDERED'">
          <p>{{ t(`已成單：${bookingLine(holder)}。行程、乘客確認和收款都在訂單裡。`) }}</p>
          <RouterLink v-if="holder.orderId" class="button block" :to="`/app/orders/${holder.orderId}`">{{ t('打開訂單') }}</RouterLink>
        </template>
        <template v-else>
          <p>{{ t(`${bookingLine(holder)} 已訂到。打開預約，按「這單我自己做」或「派給其他司機」成單。`) }}</p>
          <RouterLink class="button block" :to="`/app/bookings/${holder.id}`">{{ t('打開預約，去成單') }}</RouterLink>
        </template>
      </section>

      <section v-if="waiting.length && deal.state !== 'CANCELLED'" class="card deal__now deal__now--urgent">
        <strong>{{ t(`${waiting.length} 組預約等你確認`) }}</strong>
        <p>{{ t('打開一組預約成單，就是接受這一組；其他預約會自動婉拒。') }}</p>
        <RouterLink v-for="booking in waiting" :key="booking.id" :to="`/app/bookings/${booking.id}`" class="deal__booking">
          <span>{{ t(bookingLine(booking)) }}</span>
          <span v-if="booking.unread" class="deal__dot" :aria-label="t('未讀')"></span>
        </RouterLink>
      </section>

      <section v-if="deal.state === 'OPEN'" class="card">
        <span class="section-label">{{ t('發給乘客') }}</span>
        <GroupText :text="inWeChat ? deal.share.wechat : deal.share.whatsapp" :link-note="t('乘客打開這條連結預約，不用註冊')" />
        <div class="deal__pair">
          <button class="button" type="button" @click="copy(deal.share.wechat, '已複製，到微信貼上')">{{ t('複製（微信）') }}</button>
          <button class="button outline" type="button" @click="copy(deal.share.whatsapp, '已複製，到 WhatsApp 貼上')">{{ t('複製（WhatsApp）') }}</button>
        </div>
        <button class="button secondary block deal__gap" type="button" @click="showCard = true">{{ t('做成分享圖') }}</button>
        <div class="deal__links">
          <a v-if="!inWeChat" :href="whatsappLink(t(deal.share.whatsapp))" target="_blank" rel="noopener">{{ t('用 WhatsApp 分享') }}</a>
          <RouterLink :to="`/d/${deal.code}`">{{ t('看乘客看到的頁面') }}</RouterLink>
        </div>
        <p class="hint">{{ t('分享圖適合朋友圈、小紅書這些不顯示連結預覽的地方，乘客掃碼就能預約。') }}</p>
      </section>
      <section v-else-if="deal.state === 'EXPIRED'" class="card">
        <p class="deal__line">{{ t('已過了最後的出發時間，乘客不能再預約。想再賣，可以發一個新的特價車。') }}</p>
      </section>

      <details v-if="others.length" class="card deal__past">
        <summary>{{ t(`其他預約（${others.length}）`) }}</summary>
        <RouterLink v-for="booking in others" :key="booking.id" :to="`/app/bookings/${booking.id}`" class="deal__booking">
          <span>{{ t(bookingLine(booking)) }}</span>
          <span class="hint">{{ t(BOOKING_STATUS[booking.status].driver) }}</span>
        </RouterLink>
      </details>

      <section v-if="deal.state === 'OPEN' || canTakeDown" class="card deal__more">
        <RouterLink v-if="deal.state === 'OPEN'" class="button secondary block" :to="`/app/deals/${deal.id}/edit`">{{ t('修改特價車') }}</RouterLink>
        <button v-if="canTakeDown" class="deal__remove" type="button" :disabled="busy" @click="takeDown">{{ t('下架') }}</button>
      </section>

      <DealCardSheet v-if="showCard" :deal="deal" @close="showCard = false" />
    </template>
  </div>
</template>

<style scoped>
.deal__trip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.deal__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.deal__route {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.deal__price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 var(--space-md);
  margin: var(--space-xs) 0 0;
}
.deal__price strong {
  color: var(--color-gold-ink);
  font-size: 22px;
}
.deal__price s {
  color: var(--color-text-secondary);
}
.deal__line {
  margin: 0;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}
.deal__note {
  align-self: stretch;
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.deal__trip .hint {
  margin: var(--space-xs) 0 0;
}
.deal__now p {
  margin: var(--space-xs) 0 var(--space-md);
}
.deal__now--urgent {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.deal__booking {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: 48px;
  padding: var(--space-sm) 0;
  border-top: 1px solid var(--color-divider);
  color: var(--color-text);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.deal__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-error);
}
.deal__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
.deal__gap {
  margin-top: var(--space-md);
}
.deal__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm) var(--space-lg);
  margin: var(--space-md) 0 var(--space-sm);
  font-weight: 600;
}
.deal__past summary {
  font-weight: 600;
  cursor: pointer;
}
.deal__past .deal__booking:first-of-type {
  margin-top: var(--space-sm);
}
.deal__more {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.deal__remove {
  align-self: center;
  min-height: 44px;
  padding: 0 var(--space-xl);
  border: none;
  background: none;
  color: var(--color-error);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
</style>
