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
 * One 特價車 as its driver runs it: the text, link and picture to send passengers, and its
 * bookings. Like a product it takes any number of them, each answered on its own 詢價詳情 page,
 * where making the order accepts that party; 關閉 stops new ones.
 */
const route = useRoute();
const id = String(route.params.id);
const justMade = route.query.new === '1';
const deal = ref<DriverDeal | null>(null);
const error = ref('');
const busy = ref(false);
const showCard = ref(false);

/** Waiting for the driver: to be accepted (我確認), or booked and waiting for their order (自動接受). */
const toAnswer = computed(() => deal.value?.bookings.filter((booking) => booking.status === 'PENDING' || booking.status === 'ACCEPTED') ?? []);
const ordered = computed(() => deal.value?.bookings.filter((booking) => booking.status === 'ORDERED') ?? []);
const others = computed(() => deal.value?.bookings.filter((booking) => booking.status === 'DECLINED' || booking.status === 'CANCELLED') ?? []);
/** Still taking bookings, or only full for now: it can be changed and closed. */
const live = computed(() => deal.value?.state === 'OPEN' || deal.value?.state === 'FULL');

const bookingLine = (booking: DealBookingLine) =>
  [booking.passengerName ?? '乘客', loadLine(booking.passengers, booking.luggage), shortTime(booking.pickupAt)].join('｜');
const limitLine = (d: DriverDeal) => (d.maxBookings === null ? '不限組數，直到你關閉' : `最多接 ${d.maxBookings} 組，還剩 ${d.left} 組`);

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

async function close() {
  if (!confirm(t('關閉後乘客不能再預約；已經送出的預約照樣在這裡，你可以成單或婉拒。確定關閉？'))) return;
  busy.value = true;
  try {
    deal.value = await api<DriverDeal>('POST', `/deals/${id}/close`);
    toast('已關閉，不再接新的預約');
  } catch (e) {
    toast(errorText(e));
    await load();
  } finally {
    busy.value = false;
  }
}

/** Passengers book on their own at any time, so a live deal is read again while on screen. */
const REFRESH_MS = 15_000;
let timer: ReturnType<typeof setInterval> | undefined;
function refresh() {
  if (document.visibilityState === 'visible' && !busy.value && !showCard.value && live.value) void load();
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
          <strong>{{ t(`包車 ${money(deal.price)}`) }}</strong>
          <s v-if="deal.originalPrice">{{ t(`原價 ${money(deal.originalPrice)}`) }}</s>
        </p>
        <p v-if="dealLimits(deal)" class="deal__line">{{ t(dealLimits(deal)) }}</p>
        <p v-if="deal.notes" class="deal__note">{{ t(deal.notes) }}</p>
        <div class="deal__counts">
          <span><strong>{{ deal.waiting }}</strong>{{ t('等你確認') }}</span>
          <span><strong>{{ deal.toOrder }}</strong>{{ t('已訂到') }}</span>
          <span><strong>{{ deal.ordered }}</strong>{{ t('已成單') }}</span>
        </div>
        <p class="hint">{{ t([deal.autoAccept ? '自動接受' : '每組由你確認', limitLine(deal)].join('｜')) }}</p>
      </section>

      <section v-if="toAnswer.length" class="card deal__now deal__now--urgent">
        <strong>{{ t(`${toAnswer.length} 組預約等你處理`) }}</strong>
        <p>{{ t('打開一組，按「這單我自己做」或「派給其他司機」成單；每組各成一張單，不影響其他組。') }}</p>
        <RouterLink v-for="booking in toAnswer" :key="booking.id" :to="`/app/bookings/${booking.id}`" class="deal__booking">
          <span>
            {{ t(bookingLine(booking)) }}
            <small>{{ t(booking.status === 'ACCEPTED' ? '已訂到，等你成單' : '等你確認') }}</small>
          </span>
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
      <section v-else-if="deal.state !== 'CANCELLED'" class="card">
        <p class="deal__line">
          {{
            t(
              deal.state === 'FULL'
                ? '已接滿，乘客暫時不能再預約；有人取消或你把「最多接幾組」改大，就會重新開放。'
                : deal.state === 'CLOSED'
                  ? '已關閉，不再接新的預約。已送出的預約照樣處理。'
                  : '已過了最後的出發時間，乘客不能再預約。想再賣，可以發一個新的特價車。',
            )
          }}
        </p>
      </section>

      <section v-if="ordered.length" class="card">
        <span class="section-label">{{ t(`已成單（${ordered.length}）`) }}</span>
        <RouterLink v-for="booking in ordered" :key="booking.id" :to="booking.orderId ? `/app/orders/${booking.orderId}` : `/app/bookings/${booking.id}`" class="deal__booking">
          <span>{{ t(bookingLine(booking)) }}</span>
          <span class="hint">{{ t('打開訂單') }}</span>
        </RouterLink>
      </section>

      <details v-if="others.length" class="card deal__past">
        <summary>{{ t(`已婉拒或取消（${others.length}）`) }}</summary>
        <RouterLink v-for="booking in others" :key="booking.id" :to="`/app/bookings/${booking.id}`" class="deal__booking">
          <span>{{ t(bookingLine(booking)) }}</span>
          <span class="hint">{{ t(BOOKING_STATUS[booking.status].driver) }}</span>
        </RouterLink>
      </details>

      <section v-if="live" class="card deal__more">
        <RouterLink class="button secondary block" :to="`/app/deals/${deal.id}/edit`">{{ t('修改特價車') }}</RouterLink>
        <button class="deal__remove" type="button" :disabled="busy" @click="close">{{ t('關閉，不再接預約') }}</button>
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
.deal__counts {
  display: flex;
  gap: var(--space-lg);
  margin: var(--space-sm) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.deal__counts strong {
  display: block;
  color: var(--color-text);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.deal__booking .hint {
  flex-shrink: 0;
  white-space: nowrap;
}
.deal__booking small {
  display: block;
  font-weight: 400;
  opacity: 0.8;
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
