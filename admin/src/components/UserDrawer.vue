<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, apiFetch, can, type ApiError } from '../api';
import StatusBadge from './StatusBadge.vue';
import { ask, notify } from '../feedback';
import { CREDIT_ENTRY, dateTime, fromLocalInput, hkd, money, PLAN_NAME, PLATE_TYPE } from '../format';

/**
 * A user's details, in a drawer over the user list: the list stays where it was. The layout is
 * Master Travel's user detail drawer (admin/src/pages/users/components/UserDetailDrawer.js and
 * UserEditDrawer.js at c902bb5a, docs/REUSE.md); what it shows and does is this project's.
 */
const props = defineProps<{ userId: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();

interface Grant {
  enabled: boolean;
  quota: number | null;
  source: string;
}

interface UserDetail {
  id: string;
  phone: string;
  locale: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  profile: {
    vehicleOwnership: string | null;
    name: string;
    hkPlate: string | null;
    macauPlate: string | null;
    mainlandPlate: string | null;
    vehicleType: string | null;
    seats: number | null;
    color: string | null;
    plateType: string | null;
    hkMacauPhone: string | null;
    mainlandPhone: string | null;
    hidePlates: boolean;
  } | null;
  profilePage: {
    code: string;
    /** The address passengers open it at, the one the driver shares. */
    url: string;
    published: boolean;
    /** 讓搜尋引擎找到我. */
    searchable: boolean;
    blockedAt: string | null;
    blockedReason: string | null;
    intro: string;
    routes: string[];
    languages: string[];
    regions: string[];
    wechatId: string | null;
    whatsapp: string | null;
    photos: number;
    photoIds: string[];
    bookings: number;
  } | null;
  groupInvites: {
    id: string;
    platform: 'WECHAT' | 'WECHAT_CONTACT' | 'WHATSAPP';
    name: string;
    inviteUrl: string | null;
    hasQr: boolean;
    expiresAt: string | null;
    showOnClaimPage: boolean;
    createdAt: string;
  }[];
  notifications: { off: string[]; recent: { kind: string; summary: string; read: boolean; createdAt: string }[] };
  paymentMethods: number;
  counts: { dispatched: number; claimed: number };
  credits: {
    balance: { amount: number; currency: string };
    entries: { type: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }[];
  };
  serviceFee: { enabled: boolean; feePerOrder: { amount: number; currency: string }; exempt: boolean };
  entitlements: { orderCreate: Grant; commissionExempt: Grant };
  usage: { featureKey: string; period: string; used: number }[];
  subscriptions: { id: string; planKey: string; source: string; status: string; startsAt: string; endsAt: string | null }[];
  overrides: {
    id: string;
    planKey: string | null;
    featureKey: string | null;
    startsAt: string;
    endsAt: string | null;
    reason: string;
    active: boolean;
  }[];
}

const SOURCE: Record<string, string> = {
  override: '個別贈送',
  'feature-policy': '單一功能限時免費',
  'plan-policy': '全站免費期',
  subscription: '訂閱',
  default: '預設方案',
  none: '無',
};
const GROUP_KIND: Record<string, string> = { WECHAT: '微信群二維碼', WECHAT_CONTACT: '個人微信二維碼', WHATSAPP: 'WhatsApp 群連結' };
const NOTIFICATION_GROUP: Record<string, string> = { DISPATCHED: '我出的單', CLAIMED: '我接的單', BOOKINGS: '名片頁預約', SUPPORT: '客服' };
const NOTIFICATION_KIND: Record<string, string> = {
  ORDER_CLAIMED: '出的單有司機接了',
  ORDER_CONFIRMED: '乘客確認了行程',
  ORDER_COMPLETED: '行程已標記完成',
  ORDER_CANCELLED: '接的單被取消',
  ORDER_CANCELLED_BY_STAFF: '平台代為取消',
  ORDER_REOPENED: '接的單被改派',
  ORDER_RELEASED: '司機取消接單',
  ORDER_UNCLAIMED: '出的單還沒人接',
  ORDER_CHANGED: '接的行程被修改',
  ORDER_CHANGE_ACKED: '司機確認了行程修改',
  ORDER_SETTLED: '已結清',
  CONTACT_REVEALED: '可以看乘客電話了',
  BOOKING_NEW: '新預約',
  BOOKING_ACCEPTED: '乘客同意報價',
  BOOKING_CANCELLED: '乘客取消預約',
  CARPOOL_SEAT_NEW: '拼車有人報位',
  CARPOOL_SEAT_WAITING: '拼車報位等確認',
  CARPOOL_SEAT_CANCELLED: '乘客取消拼車報位',
  CARPOOL_FORMED: '拼車已成行',
  CARPOOL_CLOSED: '拼車已截止報位',
  DEAL_BOOKING_NEW: '特價車有人預約',
  DEAL_BOOKING_ACCEPTED: '特價車有人訂了（自動接受）',
  SUPPORT_REPLY: '客服回覆',
};

const PLANS = [
  { key: 'team', label: '團隊' },
  { key: 'company', label: '公司' },
];

const router = useRouter();
const user = ref<UserDetail | null>(null);
const error = ref('');
const base = computed(() => `/users/${props.userId}`);

async function load() {
  error.value = '';
  try {
    user.value = await api<UserDetail>('GET', base.value);
    loadImages(user.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/** An action on this user: how it went shows in the corner; the list behind is told to refresh its row. */
async function run(action: () => Promise<unknown>, done: string) {
  try {
    await action();
    notify(done);
    await load();
    emit('changed');
    return true;
  } catch (e) {
    notify((e as Error).message, true);
    return false;
  }
}

/** 停用: for abuse. The user is signed out everywhere and cannot sign in until restored. */
async function suspend() {
  const reason = await ask({
    title: '停用這個帳號',
    text: '對方會立即被登出，之後不能再登入，直到恢復。已出的單不會自動取消。',
    reason: '原因（會記在操作紀錄）',
    confirm: '停用帳號',
    danger: true,
  });
  if (reason) await run(() => api('POST', `${base.value}/suspend`, { reason }), '帳號已停用');
}

/** A trip with someone else still under way, which stops 刪除用戶 until it is dealt with. */
interface DeletionBlocker {
  id: string;
  /** CARPOOL: a 拼車 of theirs still taking seats or with passengers holding seats; the driver cancels it in the app. */
  role: 'DISPATCHED' | 'CLAIMED' | 'CARPOOL';
  pickupAt: string;
  origin: string;
  destination: string;
  legIndex: number | null;
  /** TRANSFER (接駁) or ROUND_TRIP (往返); null outside a trip. */
  journeyKind: 'TRANSFER' | 'ROUND_TRIP' | null;
  /** Parties holding seats, for a 拼車. */
  parties: number | null;
}
const deletionBlockers = ref<DeletionBlocker[]>([]);

/**
 * 刪除用戶 (超級管理員 only), for good: the orders the user put out and everything else of theirs
 * go; another dispatcher's order they took stays with that dispatcher and reads 司機已刪除. While a
 * trip with someone else is under way nothing is deleted and those orders are listed instead.
 */
async function removeUser() {
  let preview: { dispatchedOrders: number; claimedOrdersKept: number; blocking: DeletionBlocker[] };
  try {
    preview = await api('GET', `${base.value}/deletion`);
  } catch (e) {
    notify((e as Error).message, true);
    return;
  }
  deletionBlockers.value = preview.blocking;
  if (preview.blocking.length > 0) {
    notify('還有進行中的單或拼車，處理完才能刪除', true);
    return;
  }
  const kept = preview.claimedOrdersKept > 0 ? `他接過的 ${preview.claimedOrdersKept} 張別人的單會留給出單者，單上顯示「司機已刪除」。` : '';
  const reason = await ask({
    title: '刪除這個用戶',
    text: `帳號、他出的 ${preview.dispatchedOrders} 張單（連同搶單紀錄和相關通知）、名片頁與預約、開過的拼車、照片、客服對話、點數紀錄、收款方式和派單群都會刪除。${kept}刪除後無法復原。`,
    reason: '原因（會記在操作紀錄）',
    confirm: '刪除用戶',
    danger: true,
  });
  if (!reason) return;
  try {
    await api('DELETE', base.value, { reason });
  } catch (e) {
    notify((e as Error).message, true);
    // Someone took one of the user's orders meanwhile: show what stops it now.
    if ((e as ApiError).code === 'USER_HAS_ACTIVE_ORDERS') {
      deletionBlockers.value = (await api<{ blocking: DeletionBlocker[] }>('GET', `${base.value}/deletion`).catch(() => ({ blocking: [] }))).blocking;
    }
    return;
  }
  notify('用戶已刪除');
  emit('changed');
  emit('close');
}

async function restore() {
  if ((await ask({ title: '恢復這個帳號', text: '對方可以再登入。', confirm: '恢復帳號' })) === null) return;
  await run(() => api('POST', `${base.value}/restore`), '帳號已恢復');
}

/** 主動聯繫: opens this user's 客服 conversation, creating it when there is none. */
async function contact() {
  try {
    const { id } = await api<{ id: string }>('POST', '/support/conversations', { userId: props.userId });
    await router.push(`/support/${id}`);
  } catch (e) {
    notify((e as Error).message, true);
  }
}

// ---- 點數: a top-up or an adjustment, asked once more before it is made.

const crediting = ref(false);
const credit = reactive({ type: 'TOPUP' as 'TOPUP' | 'ADJUST', amount: '', note: '' });

async function changeCredits() {
  const amount = Number(credit.amount);
  const confirmed = await ask({
    title: credit.type === 'TOPUP' ? '人工充值' : '調整點數',
    text: `${credit.type === 'TOPUP' ? '充值' : '調整'} ${hkd(amount)}，備註「${credit.note}」。立即生效，記在點數紀錄和操作紀錄。`,
    confirm: '確定',
  });
  if (confirmed === null) return;
  const done = await run(() => api('POST', `${base.value}/credits`, { type: credit.type, amount, note: credit.note }), '點數已更新');
  if (done) Object.assign(credit, { amount: '', note: '' }), (crediting.value = false);
}

// ---- 方案與贈送

const gifting = ref(false);
const gift = reactive({ planKey: 'company', endsAt: '', reason: '' });

async function giftPlan() {
  const done = await run(
    () => api('POST', `${base.value}/overrides`, { planKey: gift.planKey, endsAt: fromLocalInput(gift.endsAt), reason: gift.reason }),
    '已贈送方案',
  );
  if (done) Object.assign(gift, { endsAt: '', reason: '' }), (gifting.value = false);
}

async function endOverride(id: string) {
  if ((await ask({ title: '結束這項贈送', text: '立即結束，這位用戶回到原本的方案。', confirm: '結束贈送', danger: true })) === null) return;
  await run(() => api('DELETE', `${base.value}/overrides/${id}`), '已結束贈送');
}

const quotaText = (grant: Grant) => (!grant.enabled ? '不可用' : grant.quota === null ? '不限' : `${grant.quota} 張`);

// ---- 名片頁與派單群: complaints; every action asks for a reason for the log.

/** Pictures come through the admin API, which needs the admin header, so each is read with apiFetch. */
const images = reactive<Record<string, string>>({});
async function loadImage(path: string) {
  if (images[path]) return;
  images[path] = 'loading';
  try {
    images[path] = URL.createObjectURL(await (await apiFetch('GET', path)).blob());
  } catch {
    images[path] = 'missing';
  }
}
function loadImages(detail: UserDetail) {
  for (const photoId of detail.profilePage?.photoIds ?? []) void loadImage(photoPath(photoId));
  for (const invite of detail.groupInvites) if (invite.hasQr) void loadImage(qrPath(invite.id));
}
const photoPath = (photoId: string) => `${base.value}/page/photos/${photoId}`;
const qrPath = (inviteId: string) => `${base.value}/group-invites/${inviteId}/qr`;

async function copyPageUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    notify('名片頁連結已複製');
  } catch {
    notify('複製失敗，請直接選取連結複製', true);
  }
}

async function blockPage() {
  const reason = await ask({
    title: '下架名片頁',
    text: '乘客打不開這個名片頁；司機在恢復前不能再公開，並會看到你寫的原因。',
    reason: '原因（司機看得到，也會記在操作紀錄）',
    confirm: '下架',
    danger: true,
  });
  if (reason) await run(() => api('POST', `${base.value}/page/block`, { reason }), '名片頁已下架');
}

async function restorePage() {
  if ((await ask({ title: '恢復名片頁', text: '司機可以再自己公開。', confirm: '恢復' })) === null) return;
  await run(() => api('POST', `${base.value}/page/restore`), '已恢復，司機可以再公開');
}

async function removePhoto(photoId: string) {
  const reason = await ask({ title: '刪除這張照片', text: '刪除後不能還原。', reason: '原因（會記在操作紀錄）', confirm: '刪除', danger: true });
  if (reason) await run(() => api('POST', `${base.value}/page/photos/${photoId}/remove`, { reason }), '照片已刪除');
}

async function removeGroup(inviteId: string) {
  const reason = await ask({ title: '移除這個派單群', text: '搶單頁不再顯示，刪除後不能還原。', reason: '原因（會記在操作紀錄）', confirm: '移除', danger: true });
  if (reason) await run(() => api('POST', `${base.value}/group-invites/${inviteId}/remove`, { reason }), '派單群已移除');
}

// ---- 代改司機資料: the same fields and rules as the driver's own form, in a second drawer.

const editing = ref(false);
const saving = ref(false);
const profileForm = reactive({
  name: '',
  vehicleOwnership: 'HK',
  plateType: 'DUAL',
  hkPlate: '',
  macauPlate: '',
  mainlandPlate: '',
  vehicleType: '',
  seats: '',
  color: '',
  hkMacauPhone: '',
  mainlandPhone: '',
  hidePlates: false,
});
const firstField = ref<HTMLInputElement | null>(null);

function editProfile() {
  const p = user.value?.profile;
  Object.assign(profileForm, {
    name: p?.name ?? '',
    vehicleOwnership: p?.vehicleOwnership ?? 'HK',
    plateType: p?.plateType ?? 'DUAL',
    hkPlate: p?.hkPlate ?? '',
    macauPlate: p?.macauPlate ?? '',
    mainlandPlate: p?.mainlandPlate ?? '',
    vehicleType: p?.vehicleType ?? '',
    seats: p?.seats ? String(p.seats) : '',
    color: p?.color ?? '',
    hkMacauPhone: p?.hkMacauPhone ?? '',
    mainlandPhone: p?.mainlandPhone ?? '',
    hidePlates: p?.hidePlates ?? false,
  });
  editing.value = true;
  void nextTick(() => firstField.value?.focus());
}

async function saveProfile() {
  saving.value = true;
  const saved = await run(
    () => api('PUT', `${base.value}/profile`, { ...profileForm, seats: profileForm.seats ? Number(profileForm.seats) : undefined }),
    '司機資料已更新',
  );
  saving.value = false;
  if (saved) editing.value = false;
}

// ---- 訂單: what this user put out and what they drove, the latest first; the order list has the rest.

interface OrderRow {
  id: string;
  code: string;
  status: string;
  pickupAt: string;
  origin: string;
  destination: string;
  driverPrice: { amount: number; currency: string } | null;
  passengerConfirmed: boolean;
  selfDrive: boolean;
  dispatcher: { id: string; name: string | null; phone: string };
  claimedBy: { id: string; name: string | null; phone: string } | null;
  driverDeleted: boolean;
}
const orderRole = ref<'dispatcher' | 'driver'>('dispatcher');
const orders = ref<{ total: number; items: OrderRow[] } | null>(null);
const ordersError = ref('');
async function loadOrders() {
  ordersError.value = '';
  try {
    orders.value = await api('GET', `/orders?${new URLSearchParams({ page: '1', user: props.userId, role: orderRole.value })}`);
  } catch (e) {
    ordersError.value = (e as Error).message;
  }
}
watch(orderRole, () => void loadOrders());
/** Who was on the other side: the driver of what this user put out, the dispatcher of what they drove. */
const otherSide = (order: OrderRow) => (order.selfDrive ? null : orderRole.value === 'dispatcher' ? order.claimedBy : order.dispatcher);
const ORDERS_SHOWN = 10;

// ---- 特價車: what this user put up; 下架 after a complaint, with a reason the driver sees.
interface DealRow {
  id: string;
  url: string;
  state: 'OPEN' | 'FULL' | 'CLOSED' | 'CANCELLED' | 'EXPIRED';
  pickupAt: string;
  pickupUntil: string | null;
  origin: string;
  destination: string;
  price: { amount: number; currency: string };
  originalPrice: { amount: number; currency: string } | null;
  bookings: number;
  ordered: number;
  maxBookings: number | null;
  staffReason: string | null;
  /** 刪除 by the driver. */
  deletedAt: string | null;
  createdAt: string;
}
const DEAL_STATE: Record<DealRow['state'], { label: string; tone: string }> = {
  OPEN: { label: '開放預約', tone: 'pending' },
  FULL: { label: '已接滿', tone: 'completed' },
  CLOSED: { label: '司機已關閉', tone: '' },
  CANCELLED: { label: '已下架', tone: 'cancelled' },
  EXPIRED: { label: '已過期', tone: '' },
};
const deals = ref<DealRow[] | null>(null);
const dealsError = ref('');
async function loadDeals() {
  dealsError.value = '';
  try {
    deals.value = await api<DealRow[]>('GET', `${base.value}/deals`);
  } catch (e) {
    dealsError.value = (e as Error).message;
  }
}
async function cancelDeal(deal: DealRow) {
  const reason = await ask({
    title: '下架這個特價車',
    text: '乘客不能再預約，還在等的預約會婉拒；已成單的照常進行，要取消請到那張單。司機看得到你寫的原因。',
    reason: '原因（司機看得到，也會記在操作紀錄）',
    confirm: '下架',
    danger: true,
  });
  if (!reason) return;
  try {
    deals.value = await api<DealRow[]>('POST', `${base.value}/deals/${deal.id}/cancel`, { reason });
    notify('特價車已下架');
  } catch (e) {
    notify((e as Error).message, true);
  }
}

function openOrder(id: string) {
  void router.push(`/orders/${id}`);
}

const plates = computed(() => {
  const p = user.value?.profile;
  return p ? [p.hkPlate, p.macauPlate, p.mainlandPlate].filter(Boolean).join(' / ') || '—' : '—';
});

// The drawer holds the keyboard: Esc closes the edit drawer first, then this one.
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || document.querySelector('.feedback__backdrop')) return;
  if (editing.value) {
    if (!saving.value) editing.value = false;
  } else emit('close');
}

watch(
  () => props.userId,
  () => {
    user.value = null;
    orders.value = null;
    editing.value = false;
    crediting.value = false;
    gifting.value = false;
    deletionBlockers.value = [];
    deals.value = null;
    void load();
    void loadOrders();
    void loadDeals();
  },
);

onMounted(() => {
  void load();
  void loadOrders();
  void loadDeals();
  document.addEventListener('keydown', onKey);
  document.body.classList.add('mt-overlay-open');
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.classList.remove('mt-overlay-open');
  for (const url of Object.values(images)) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
});
</script>

<template>
  <div class="mt-drawer-backdrop" @click="emit('close')"></div>
  <aside class="mt-drawer" role="dialog" aria-modal="true" aria-labelledby="user-drawer-title">
    <header class="mt-drawer-head">
      <h2 id="user-drawer-title">{{ user ? (user.profile?.name ?? '未填姓名') : '載入中…' }}</h2>
      <span v-if="user" class="mt-muted">{{ user.phone }} · {{ user.id }}</span>
      <button type="button" class="mt-close" aria-label="關閉" @click="emit('close')">×</button>
      <template v-if="user">
        <div class="mt-drawer-meta">
          <span><b>加入日期</b>{{ dateTime(user.createdAt) }}</span>
          <span><b>介面語言</b>{{ user.locale === 'zh-Hans' ? '簡體' : '繁體' }}</span>
          <span><b>派單／接單</b>{{ user.counts.dispatched }} / {{ user.counts.claimed }}</span>
        </div>
        <div class="mt-drawer-status">
          <span class="mt-status" :class="user.suspendedAt ? 'cancelled' : 'completed'">{{ user.suspendedAt ? '已停用' : '使用中' }}</span>
          <template v-if="can.write()">
            <button type="button" class="mt-button secondary" @click="contact">用客服聯絡</button>
            <button v-if="user.suspendedAt" type="button" class="mt-button restore" @click="restore">恢復用戶</button>
            <button v-else type="button" class="mt-button danger-outline" @click="suspend">停用用戶</button>
          </template>
          <!-- Deleting cannot be undone: set apart at the end, the one solid red button. -->
          <button v-if="can.superAdmin()" type="button" class="mt-button danger mt-drawer-status__end" @click="removeUser">刪除用戶</button>
        </div>
      </template>
    </header>

    <div v-if="error" class="mt-drawer-body">
      <div class="notice error">{{ error }} <button class="button secondary" type="button" @click="load">重試</button></div>
    </div>

    <div v-if="user" class="mt-drawer-body">
      <div v-if="user.suspendedAt" class="notice error">{{ dateTime(user.suspendedAt) }} 停用，原因：{{ user.suspendedReason ?? '—' }}</div>
      <div v-if="deletionBlockers.length > 0" class="notice error">
        還不能刪除：以下的單或拼車還在進行中，先處理（例如代為取消、等行程完成，或請司機在 app 裡取消拼車）再刪除。
        <ul>
          <li v-for="order in deletionBlockers" :key="order.id">
            <template v-if="order.role === 'CARPOOL'">
              {{ dateTime(order.pickupAt) }} {{ order.origin }} 至 {{ order.destination }}
              · 他開的拼車，{{ order.parties ? `${order.parties} 組乘客已報位` : '還在招募' }}
            </template>
            <template v-else>
              <RouterLink :to="`/orders/${order.id}`">
                {{ dateTime(order.pickupAt) }} {{ order.origin }} 至 {{ order.destination }}{{ order.legIndex ? (order.journeyKind === 'ROUND_TRIP' ? `（往返${order.legIndex === 1 ? '去程' : '回程'}）` : `（接駁第 ${order.legIndex} 段）`) : '' }}
              </RouterLink>
              · {{ order.role === 'DISPATCHED' ? '他出的單，別的司機接了' : '他接了別人的單' }}
            </template>
          </li>
        </ul>
      </div>

      <section class="mt-section">
        <div class="mt-section-head">
          <div><h3>點數與方案</h3></div>
        </div>
        <div class="mt-cards">
          <article>
            <span>點數餘額</span>
            <strong>{{ money(user.credits.balance) }}</strong>
            <small>服務費：{{ !user.serviceFee.enabled ? '平台未開啟' : user.serviceFee.exempt ? '免收' : `每單 ${money(user.serviceFee.feePerOrder)}` }}</small>
            <button v-if="can.write() && !crediting" type="button" class="mt-action user-drawer__card-action" @click="crediting = true">充值或調整</button>
          </article>
          <article>
            <span>每月出單額度</span>
            <strong>{{ quotaText(user.entitlements.orderCreate) }}</strong>
            <small>來源：{{ SOURCE[user.entitlements.orderCreate.source] }}</small>
            <button v-if="can.write() && !gifting" type="button" class="mt-action user-drawer__card-action" @click="gifting = true">贈送方案</button>
          </article>
        </div>
        <form v-if="crediting" class="mt-inline-form" @submit.prevent="changeCredits">
          <label class="mt-field">
            類型
            <select v-model="credit.type">
              <option value="TOPUP">人工充值</option>
              <option value="ADJUST">調整（可為負數）</option>
            </select>
          </label>
          <label class="mt-field">金額（HK$）<input v-model="credit.amount" type="number" step="0.01" required /></label>
          <label class="mt-field">備註<input v-model="credit.note" placeholder="例如：轉數快 #123" required /></label>
          <button type="submit" class="mt-button">確定</button>
          <button type="button" class="mt-button secondary" @click="crediting = false">取消</button>
        </form>
        <form v-if="gifting" class="mt-inline-form user-drawer__gift" @submit.prevent="giftPlan">
          <label class="mt-field">
            方案
            <select v-model="gift.planKey">
              <option v-for="plan in PLANS" :key="plan.key" :value="plan.key">{{ plan.label }}</option>
            </select>
          </label>
          <label class="mt-field">結束（留空為不限）<input v-model="gift.endsAt" type="datetime-local" /></label>
          <label class="mt-field">原因<input v-model="gift.reason" placeholder="例如：Master Travel 客戶" required /></label>
          <button type="submit" class="mt-button">贈送</button>
          <button type="button" class="mt-button secondary" @click="gifting = false">取消</button>
        </form>
        <table v-if="user.subscriptions.length || user.overrides.length" class="mt-history user-drawer__plans">
          <thead><tr><th>方案或贈送</th><th>期間</th><th>原因或來源</th><th></th></tr></thead>
          <tbody>
            <tr v-for="sub in user.subscriptions" :key="sub.id">
              <td>訂閱：{{ PLAN_NAME[sub.planKey] ?? sub.planKey }}</td>
              <td>{{ dateTime(sub.startsAt) }} 至 {{ sub.endsAt ? dateTime(sub.endsAt) : '不限' }}</td>
              <td>{{ sub.source }}・{{ sub.status }}</td>
              <td></td>
            </tr>
            <tr v-for="item in user.overrides" :key="item.id">
              <td>
                {{ item.planKey ? `贈送：${PLAN_NAME[item.planKey] ?? item.planKey}` : `功能：${item.featureKey}` }}
                <span v-if="item.active" class="mt-status completed">生效中</span>
              </td>
              <td>{{ dateTime(item.startsAt) }} 至 {{ item.endsAt ? dateTime(item.endsAt) : '不限' }}</td>
              <td>{{ item.reason }}</td>
              <td class="num"><button v-if="item.active && can.write()" type="button" class="mt-action is-danger" @click="endOverride(item.id)">結束</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="mt-section">
        <div class="mt-section-head">
          <div><h3>司機資料</h3></div>
          <button v-if="can.write()" type="button" class="mt-action" @click="editProfile">代改司機資料</button>
        </div>
        <p v-if="!user.profile" class="mt-muted">尚未填寫（第一次搶單前會要求填寫）</p>
        <dl v-else class="mt-facts">
          <div><dt>姓名</dt><dd>{{ user.profile.name }}</dd></div>
          <div><dt>車牌</dt><dd>{{ plates }}</dd></div>
          <div><dt>車牌類型</dt><dd>{{ user.profile.plateType ? PLATE_TYPE[user.profile.plateType] : '—' }}</dd></div>
          <div><dt>車型</dt><dd>{{ user.profile.vehicleType ?? '—' }}</dd></div>
          <div><dt>座位</dt><dd>{{ user.profile.seats ?? '—' }}</dd></div>
          <div><dt>車色</dt><dd>{{ user.profile.color ?? '—' }}</dd></div>
          <div><dt>港澳號碼</dt><dd>{{ user.profile.hkMacauPhone ?? '—' }}</dd></div>
          <div><dt>內地號碼</dt><dd>{{ user.profile.mainlandPhone ?? '—' }}</dd></div>
          <div><dt>對乘客隱藏車牌</dt><dd>{{ user.profile.hidePlates ? '是' : '否' }}</dd></div>
        </dl>
        <p v-if="user.profile">港澳與內地號碼由司機自己填寫，沒有經過簡訊驗證；登入用的是上方的號碼。</p>
      </section>

      <section class="mt-section">
        <div class="mt-section-head">
          <div><h3>訂單</h3></div>
          <div class="mt-segmented" role="group" aria-label="出的單或接的單">
            <button type="button" :class="{ 'is-active': orderRole === 'dispatcher' }" :aria-pressed="orderRole === 'dispatcher'" @click="orderRole = 'dispatcher'">
              出的單 {{ user.counts.dispatched }}
            </button>
            <button type="button" :class="{ 'is-active': orderRole === 'driver' }" :aria-pressed="orderRole === 'driver'" @click="orderRole = 'driver'">
              接的單 {{ user.counts.claimed }}
            </button>
          </div>
        </div>
        <div v-if="ordersError" class="notice error">{{ ordersError }} <button class="button secondary" type="button" @click="loadOrders">重試</button></div>
        <p v-else-if="!orders" class="mt-muted">載入中…</p>
        <p v-else-if="orders.items.length === 0" class="mt-muted">{{ orderRole === 'dispatcher' ? '還沒有出過單' : '還沒有接過單' }}</p>
        <div v-else class="mt-history-wrap">
          <table class="mt-history">
            <thead>
              <tr><th>出發時間</th><th>路線</th><th>狀態</th><th>{{ orderRole === 'dispatcher' ? '接單司機' : '出單者' }}</th><th class="num">出單價</th></tr>
            </thead>
            <tbody>
              <tr v-for="order in orders.items.slice(0, ORDERS_SHOWN)" :key="order.id" class="mt-row" @click="openOrder(order.id)">
                <td>{{ dateTime(order.pickupAt) }}<br /><span class="mt-muted">{{ order.code }}</span></td>
                <td>{{ order.origin }} 至 {{ order.destination }}</td>
                <td><StatusBadge :status="order.status" :confirmed="order.passengerConfirmed" /></td>
                <td>{{ otherSide(order)?.name ?? (order.selfDrive ? (orderRole === 'dispatcher' ? '自己做' : '自己出的單') : order.driverDeleted ? '司機已刪除' : '—') }}</td>
                <td class="num">{{ money(order.driverPrice) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="orders && orders.total > 0">
          最近 {{ Math.min(orders.items.length, ORDERS_SHOWN) }} 張，共 {{ orders.total }} 張。
          <RouterLink :to="{ path: '/orders', query: { user: userId, role: orderRole } }">在訂單列表查看全部</RouterLink>
        </p>
      </section>

      <section class="mt-section">
        <div class="mt-section-head">
          <div><h3>特價車</h3></div>
        </div>
        <div v-if="dealsError" class="notice error">{{ dealsError }} <button class="button secondary" type="button" @click="loadDeals">重試</button></div>
        <p v-else-if="!deals" class="mt-muted">載入中…</p>
        <p v-else-if="deals.length === 0" class="mt-muted">沒有發過特價車。</p>
        <div v-else class="mt-history-wrap">
          <table class="mt-history">
            <thead>
              <tr><th>出發時間</th><th>路線</th><th>狀態</th><th class="num">每組特價</th><th class="num">預約／成單</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="deal in deals" :key="deal.id">
                <td>{{ dateTime(deal.pickupAt) }}<template v-if="deal.pickupUntil"><br /><span class="mt-muted">至 {{ dateTime(deal.pickupUntil) }}</span></template></td>
                <td>
                  <a :href="deal.url" target="_blank" rel="noopener noreferrer">{{ deal.origin }} 至 {{ deal.destination }}</a>
                  <br v-if="deal.staffReason" /><span v-if="deal.staffReason" class="mt-muted">平台下架：{{ deal.staffReason }}</span>
                </td>
                <td>
                  <span class="mt-status" :class="DEAL_STATE[deal.state].tone">{{ DEAL_STATE[deal.state].label }}</span>
                  <br v-if="deal.deletedAt" /><span v-if="deal.deletedAt" class="mt-muted">司機 {{ dateTime(deal.deletedAt) }} 刪除</span>
                </td>
                <td class="num">{{ money(deal.price) }}<template v-if="deal.originalPrice"><br /><s class="mt-muted">{{ money(deal.originalPrice) }}</s></template></td>
                <td class="num">{{ deal.bookings }}／{{ deal.ordered }}<template v-if="deal.maxBookings"><br /><span class="mt-muted">最多 {{ deal.maxBookings }} 組</span></template></td>
                <td>
                  <button v-if="can.write() && deal.state !== 'CANCELLED' && !deal.deletedAt" type="button" class="mt-action is-danger" @click="cancelDeal(deal)">下架</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mt-section">
        <div class="mt-section-head">
          <div><h3>名片頁與派單群</h3></div>
          <template v-if="can.write() && user.profilePage">
            <button v-if="user.profilePage.blockedAt" type="button" class="mt-action is-restore" @click="restorePage">恢復名片頁</button>
            <button v-else type="button" class="mt-action is-danger" @click="blockPage">下架名片頁</button>
          </template>
        </div>
        <p v-if="!user.profilePage" class="mt-muted">還沒有打開過名片頁設定。</p>
        <template v-else>
          <div v-if="user.profilePage.blockedAt" class="notice error">{{ dateTime(user.profilePage.blockedAt) }} 下架，原因：{{ user.profilePage.blockedReason ?? '—' }}</div>
          <div class="user-drawer__page-link">
            <span>名片頁連結</span>
            <a :href="user.profilePage.url" target="_blank" rel="noopener noreferrer">{{ user.profilePage.url }}</a>
            <button type="button" class="mt-action" @click="copyPageUrl(user.profilePage.url)">複製</button>
            <small v-if="user.profilePage.blockedAt || !user.profilePage.published" class="mt-muted">
              {{ user.profilePage.blockedAt ? '已下架' : '未公開' }}，乘客目前打不開。
            </small>
          </div>
          <dl class="mt-facts">
            <div>
              <dt>狀態</dt>
              <dd>
                <span class="mt-status" :class="user.profilePage.blockedAt ? 'cancelled' : user.profilePage.published ? 'completed' : ''">
                  {{ user.profilePage.blockedAt ? '已下架' : user.profilePage.published ? '已公開' : '未公開' }}
                </span>
              </dd>
            </div>
            <div><dt>收到預約</dt><dd>{{ user.profilePage.bookings }} 個</dd></div>
            <div><dt>讓搜尋引擎找到</dt><dd>{{ user.profilePage.searchable ? '是' : '否' }}</dd></div>
            <div><dt>微信號</dt><dd>{{ user.profilePage.wechatId ?? '—' }}</dd></div>
            <div><dt>WhatsApp</dt><dd>{{ user.profilePage.whatsapp ?? '—' }}</dd></div>
            <div><dt>收款方式</dt><dd>{{ user.paymentMethods }} 個</dd></div>
            <div class="is-wide"><dt>介紹</dt><dd>{{ user.profilePage.intro || '—' }}</dd></div>
            <div><dt>路線</dt><dd>{{ user.profilePage.routes.join('、') || '—' }}</dd></div>
            <div><dt>語言</dt><dd>{{ user.profilePage.languages.join('、') || '—' }}</dd></div>
            <div><dt>服務地區</dt><dd>{{ user.profilePage.regions.join('、') || '—' }}</dd></div>
          </dl>
          <div v-if="user.profilePage.photoIds.length" class="user-drawer__media">
            <figure v-for="photoId in user.profilePage.photoIds" :key="photoId">
              <a v-if="images[photoPath(photoId)]?.startsWith('blob:')" :href="images[photoPath(photoId)]" target="_blank" rel="noopener">
                <img :src="images[photoPath(photoId)]" alt="車輛照片" />
              </a>
              <span v-else class="user-drawer__missing">{{ images[photoPath(photoId)] === 'missing' ? '讀取不到照片' : '載入中' }}</span>
              <button v-if="can.write()" type="button" class="mt-action is-danger" @click="removePhoto(photoId)">刪除照片</button>
            </figure>
          </div>
          <p>收款方式的帳號與收款碼只給用戶自己和他選擇顯示的乘客，後台不顯示。</p>
        </template>
        <h4 class="user-drawer__sub">派單群</h4>
        <p v-if="user.groupInvites.length === 0" class="mt-muted">沒有加入派單群。</p>
        <div v-else class="user-drawer__media">
          <figure v-for="invite in user.groupInvites" :key="invite.id">
            <template v-if="invite.hasQr">
              <a v-if="images[qrPath(invite.id)]?.startsWith('blob:')" :href="images[qrPath(invite.id)]" target="_blank" rel="noopener">
                <img :src="images[qrPath(invite.id)]" alt="二維碼" />
              </a>
              <span v-else class="user-drawer__missing">{{ images[qrPath(invite.id)] === 'missing' ? '讀取不到二維碼' : '載入中' }}</span>
            </template>
            <figcaption>
              <b>{{ invite.name || GROUP_KIND[invite.platform] }}</b>
              <span class="mt-muted">{{ GROUP_KIND[invite.platform] }}・{{ invite.showOnClaimPage ? '在搶單頁顯示' : '不在搶單頁顯示' }}</span>
              <span v-if="invite.inviteUrl" class="mt-muted">{{ invite.inviteUrl }}</span>
              <span v-if="invite.expiresAt" class="mt-muted">{{ dateTime(invite.expiresAt) }} 過期</span>
            </figcaption>
            <button v-if="can.write()" type="button" class="mt-action is-danger" @click="removeGroup(invite.id)">移除</button>
          </figure>
        </div>
      </section>

      <section class="mt-section">
        <div class="mt-section-head">
          <div><h3>點數紀錄</h3></div>
        </div>
        <p v-if="user.credits.entries.length === 0" class="mt-muted">沒有紀錄。</p>
        <div v-else class="mt-history-wrap">
          <table class="mt-history">
            <thead><tr><th>時間</th><th>類型</th><th class="num">金額</th><th class="num">餘額</th><th>備註</th></tr></thead>
            <tbody>
              <tr v-for="(entry, i) in user.credits.entries" :key="i">
                <td>{{ dateTime(entry.createdAt) }}</td>
                <td>{{ CREDIT_ENTRY[entry.type] ?? entry.type }}</td>
                <td class="num">{{ hkd(entry.amount) }}</td>
                <td class="num">{{ hkd(entry.balanceAfter) }}</td>
                <td>{{ entry.note ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mt-section">
        <div class="mt-section-head">
          <div><h3>通知</h3></div>
        </div>
        <p class="user-drawer__first">
          關掉的通知：{{ user.notifications.off.map((group) => NOTIFICATION_GROUP[group] ?? group).join('、') || '沒有' }}。
          通知只在司機開著頁面時跳出；提示音開關存在司機手機上，後台看不到。
        </p>
        <p v-if="user.notifications.recent.length === 0" class="mt-muted">最近沒有通知。</p>
        <div v-else class="mt-history-wrap">
          <table class="mt-history">
            <thead><tr><th>時間</th><th>通知</th><th>行程</th><th>已讀</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in user.notifications.recent" :key="i">
                <td>{{ dateTime(item.createdAt) }}</td>
                <td>{{ NOTIFICATION_KIND[item.kind] ?? item.kind }}</td>
                <td>{{ item.summary || '—' }}</td>
                <td><span class="mt-status" :class="{ confirmed: !item.read }">{{ item.read ? '已讀' : '未讀' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </aside>

  <template v-if="editing && user">
    <div class="mt-drawer-backdrop mt-drawer-backdrop--edit" @click="saving || (editing = false)"></div>
    <form class="mt-drawer mt-drawer--edit" role="dialog" aria-modal="true" aria-labelledby="user-edit-title" @submit.prevent="saveProfile">
      <div class="mt-edit-head">
        <div>
          <h3 id="user-edit-title">代改司機資料</h3>
          <p class="mt-muted">和司機自己填的表單同一套規則；修改會記在操作紀錄。</p>
        </div>
        <button type="button" class="mt-close" aria-label="關閉" :disabled="saving" @click="editing = false">×</button>
      </div>
      <div class="mt-edit-body">
        <h4 class="mt-form-section">基本資料</h4>
        <div class="mt-grid-3">
          <label class="mt-field">姓名或稱呼 <input ref="firstField" v-model="profileForm.name" maxlength="30" required /></label>
          <label class="mt-field">
            車輛歸屬地
            <select v-model="profileForm.vehicleOwnership">
              <option value="HK">香港</option>
              <option value="MACAU">澳門</option>
              <option value="MAINLAND">中國內地</option>
            </select>
          </label>
          <label class="mt-field">
            車牌類型
            <select v-model="profileForm.plateType">
              <option value="SINGLE">單牌</option>
              <option value="DUAL">兩地牌</option>
              <option value="TRIPLE">三地牌</option>
            </select>
          </label>
          <label class="mt-field">車型 <input v-model="profileForm.vehicleType" maxlength="30" required /></label>
          <label class="mt-field">座位 <input v-model="profileForm.seats" type="number" min="1" max="60" /></label>
          <label class="mt-field">車色 <input v-model="profileForm.color" maxlength="20" /></label>
        </div>
        <h4 class="mt-form-section">車牌資料</h4>
        <div class="mt-grid-3">
          <label class="mt-field">香港車牌 <input v-model="profileForm.hkPlate" maxlength="12" /></label>
          <label class="mt-field">澳門車牌 <input v-model="profileForm.macauPlate" maxlength="12" placeholder="AA-00-00" /></label>
          <label class="mt-field">內地車牌 <input v-model="profileForm.mainlandPlate" maxlength="12" placeholder="粵Z·1234港" /></label>
        </div>
        <p class="mt-muted">車牌類型決定哪些車牌必填；內地車牌要寫完整，例如 粵Z·1234港。</p>
        <h4 class="mt-form-section">聯絡號碼</h4>
        <div class="mt-grid-2">
          <label class="mt-field">港澳號碼 <input v-model="profileForm.hkMacauPhone" placeholder="+852 91234567" /></label>
          <label class="mt-field">內地號碼 <input v-model="profileForm.mainlandPhone" placeholder="+86 13800001111" /></label>
        </div>
        <label class="mt-check">
          <input v-model="profileForm.hidePlates" type="checkbox" />
          <span>對乘客隱藏車牌<br /><small class="mt-muted">乘客確認頁不顯示這位司機的車牌。</small></span>
        </label>
      </div>
      <div class="mt-edit-actions">
        <button type="button" class="mt-button secondary" :disabled="saving" @click="editing = false">取消</button>
        <button type="submit" class="mt-button" :disabled="saving">{{ saving ? '儲存中…' : '儲存' }}</button>
      </div>
    </form>
  </template>
</template>

<style scoped>
.user-drawer__card-action {
  margin-top: 4px;
}
.user-drawer__gift {
  grid-template-columns: minmax(100px, 0.7fr) minmax(150px, 1fr) minmax(150px, 1.4fr) auto auto;
}
.user-drawer__plans {
  margin-top: 14px;
}
.user-drawer__sub {
  margin: 18px 0 10px;
  padding-top: 14px;
  border-top: 1px solid #edf1f6;
  color: #233d5d;
  font-size: 13px;
}
/* The page's address on one line of its own: the label, the link, and a way to copy it. */
.user-drawer__page-link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #e1eaf4;
  border-radius: 10px;
  background: #f7fbff;
  font-size: 13px;
}

.user-drawer__page-link > span {
  color: #647892;
  font-size: 11px;
  font-weight: 700;
}

.user-drawer__page-link > a {
  flex: 1 1 200px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.user-drawer__page-link > small {
  flex-basis: 100%;
}

.user-drawer__media {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}
.user-drawer__media figure {
  display: grid;
  gap: 8px;
  width: 170px;
  margin: 0;
}
.user-drawer__media img {
  display: block;
  width: 100%;
  height: 120px;
  border-radius: 10px;
  object-fit: cover;
}
.user-drawer__media figcaption {
  display: grid;
  gap: 2px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.user-drawer__missing {
  display: grid;
  place-items: center;
  height: 120px;
  border-radius: 10px;
  color: #8a9ab0;
  background: #f1f5fa;
  font-size: 12px;
}
.user-drawer__first {
  margin: 0 0 10px !important;
}
</style>
