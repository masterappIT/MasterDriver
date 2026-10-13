<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, apiFetch, can } from '../api';
import { CREDIT_ENTRY, dateTime, fromLocalInput, hkd, money, PLAN_NAME, PLATE_TYPE } from '../format';

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
    published: boolean;
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
  ORDER_SETTLED: '已結清',
  CONTACT_REVEALED: '可以看乘客電話了',
  BOOKING_NEW: '新預約',
  BOOKING_ACCEPTED: '乘客同意報價',
  BOOKING_CANCELLED: '乘客取消預約',
  SUPPORT_REPLY: '客服回覆',
};
const PLANS = [
  { key: 'team', label: '團隊' },
  { key: 'company', label: '公司' },
];

const route = useRoute();
const router = useRouter();
const user = ref<UserDetail | null>(null);
const error = ref('');
const message = ref('');
const credit = reactive({ type: 'TOPUP' as 'TOPUP' | 'ADJUST', amount: '', note: '' });
const gift = reactive({ planKey: 'company', endsAt: '', reason: '' });

async function load() {
  try {
    user.value = await api<UserDetail>('GET', `/users/${route.params.id}`);
    loadImages(user.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function run(action: () => Promise<unknown>, done: string) {
  error.value = '';
  message.value = '';
  try {
    await action();
    message.value = done;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/** 停用: for abuse. The user is signed out everywhere and cannot sign in until restored. */
function suspend() {
  const reason = prompt('停用這個帳號：對方會立即被登出，之後不能再登入，直到恢復。已出的單不會自動取消。\n請寫原因（會記在操作紀錄）：')?.trim();
  if (!reason) return;
  return run(() => api('POST', `/users/${route.params.id}/suspend`, { reason }), '帳號已停用');
}

function restore() {
  if (!confirm('恢復這個帳號？對方可以再登入。')) return;
  return run(() => api('POST', `/users/${route.params.id}/restore`), '帳號已恢復');
}

// ---- complaints about the 名片頁 and 派單群: every action asks for a reason for the log.

/**
 * Pictures come through the admin API, which needs the admin header, so each is read with
 * apiFetch and shown from memory, as on the 客服 page.
 */
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
onBeforeUnmount(() => {
  for (const url of Object.values(images)) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
});
const photoPath = (photoId: string) => `/users/${route.params.id}/page/photos/${photoId}`;
const qrPath = (inviteId: string) => `/users/${route.params.id}/group-invites/${inviteId}/qr`;

function blockPage() {
  const reason = prompt('下架名片頁：乘客打不開，司機在恢復前不能再公開，並會看到下面寫的原因。\n請寫原因：')?.trim();
  if (!reason) return;
  return run(() => api('POST', `/users/${route.params.id}/page/block`, { reason }), '名片頁已下架');
}

function restorePage() {
  if (!confirm('恢復名片頁？司機可以再自己公開。')) return;
  return run(() => api('POST', `/users/${route.params.id}/page/restore`), '已恢復，司機可以再公開');
}

function removePhoto(photoId: string) {
  const reason = prompt('刪除這張照片：刪除後不能還原。\n請寫原因（會記在操作紀錄）：')?.trim();
  if (!reason) return;
  return run(() => api('POST', `/users/${route.params.id}/page/photos/${photoId}/remove`, { reason }), '照片已刪除');
}

function removeGroup(inviteId: string) {
  const reason = prompt('移除這個派單群：搶單頁不再顯示，刪除後不能還原。\n請寫原因（會記在操作紀錄）：')?.trim();
  if (!reason) return;
  return run(() => api('POST', `/users/${route.params.id}/group-invites/${inviteId}/remove`, { reason }), '派單群已移除');
}

/** 代改司機資料: the same fields and rules as the driver's own form. */
const editingProfile = ref(false);
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
  editingProfile.value = true;
}

async function saveProfile() {
  await run(
    () => api('PUT', `/users/${route.params.id}/profile`, { ...profileForm, seats: profileForm.seats ? Number(profileForm.seats) : undefined }),
    '司機資料已更新',
  );
  if (!error.value) editingProfile.value = false;
}

function changeCredits() {
  return run(async () => {
    await api('POST', `/users/${route.params.id}/credits`, {
      type: credit.type,
      amount: Number(credit.amount),
      note: credit.note,
    });
    credit.amount = '';
    credit.note = '';
  }, '點數已更新');
}

function giftPlan() {
  return run(async () => {
    await api('POST', `/users/${route.params.id}/overrides`, {
      planKey: gift.planKey,
      endsAt: fromLocalInput(gift.endsAt),
      reason: gift.reason,
    });
    gift.reason = '';
    gift.endsAt = '';
  }, '已贈送方案');
}

function endOverride(id: string) {
  if (!confirm('確定結束這項贈送？')) return;
  return run(() => api('DELETE', `/users/${route.params.id}/overrides/${id}`), '已結束贈送');
}

/** 主動聯繫: opens this user's 客服 conversation, creating it when there is none. */
async function contact() {
  error.value = '';
  try {
    const { id } = await api<{ id: string }>('POST', '/support/conversations', { userId: route.params.id });
    await router.push(`/support/${id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const quotaText = (grant: Grant) => (!grant.enabled ? '不可用' : grant.quota === null ? '不限' : `${grant.quota} 張`);

onMounted(load);
</script>

<template>
  <RouterLink to="/users" class="hint">返回用戶</RouterLink>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <template v-if="user">
    <h1>{{ user.profile?.name ?? '未填姓名' }}　<span class="muted">{{ user.phone }}</span></h1>
    <div v-if="user.suspendedAt" class="notice error">
      這個帳號已於 {{ dateTime(user.suspendedAt) }} 停用，不能登入。原因：{{ user.suspendedReason ?? '—' }}
    </div>
    <p v-if="can.write()" class="row">
      <button class="button secondary" type="button" @click="contact">用客服聯絡這位用戶</button>
      <button v-if="user.suspendedAt" class="button" type="button" @click="restore">恢復帳號</button>
      <button v-else class="button danger" type="button" @click="suspend">停用帳號</button>
    </p>

    <div class="grid">
      <div class="card">
        <div class="muted">派單／接單</div>
        <div class="stat">{{ user.counts.dispatched }} / {{ user.counts.claimed }}</div>
      </div>
      <div class="card">
        <div class="muted">點數餘額</div>
        <div class="stat">{{ money(user.credits.balance) }}</div>
        <div class="hint">
          服務費：{{
            !user.serviceFee.enabled ? '平台未開啟' : user.serviceFee.exempt ? '免收' : `每單 ${money(user.serviceFee.feePerOrder)}`
          }}
        </div>
      </div>
      <div class="card">
        <div class="muted">每月出單額度</div>
        <div class="stat">{{ quotaText(user.entitlements.orderCreate) }}</div>
        <div class="hint">來源：{{ SOURCE[user.entitlements.orderCreate.source] }}</div>
      </div>
    </div>

    <div class="card">
      <h2>司機資料</h2>
      <p v-if="!user.profile" class="muted">尚未填寫（第一次搶單前會要求填寫）</p>
      <div v-else class="row">
        <span>港牌：{{ user.profile.hkPlate ?? '—' }}</span>
        <span>澳牌：{{ user.profile.macauPlate ?? '—' }}</span>
        <span>內地牌：{{ user.profile.mainlandPlate ?? '—' }}</span>
        <span>車型：{{ user.profile.vehicleType ?? '—' }}</span>
        <span>座位：{{ user.profile.seats ?? '—' }}</span>
        <span>車色：{{ user.profile.color ?? '—' }}</span>
        <span>車牌類型：{{ user.profile.plateType ? PLATE_TYPE[user.profile.plateType] : '—' }}</span>
        <span>港澳號碼：{{ user.profile.hkMacauPhone ?? '—' }}</span>
        <span>內地號碼：{{ user.profile.mainlandPhone ?? '—' }}</span>
        <span>對乘客隱藏車牌：{{ user.profile.hidePlates ? '是' : '否' }}</span>
      </div>
      <p class="hint">港澳號碼與內地號碼由司機自己填寫，沒有經過簡訊驗證；登入用的是上方的號碼。</p>
      <p v-if="can.write() && !editingProfile"><button class="button secondary" type="button" @click="editProfile">代改司機資料</button></p>
      <form v-if="editingProfile" class="user-profile-form" @submit.prevent="saveProfile">
        <p class="hint">和司機自己填的表單同一套規則：車牌類型決定哪些車牌必填；內地車牌要寫完整（例如 粵Z·1234港）；號碼要含區號（+852 91234567）。修改會記在操作紀錄。</p>
        <div class="row">
          <label class="field">姓名或稱呼<input v-model="profileForm.name" class="input" maxlength="30" required /></label>
          <label class="field">
            車輛歸屬地
            <select v-model="profileForm.vehicleOwnership" class="select">
              <option value="HK">香港</option>
              <option value="MACAU">澳門</option>
              <option value="MAINLAND">中國內地</option>
            </select>
          </label>
          <label class="field">
            車牌類型
            <select v-model="profileForm.plateType" class="select">
              <option value="SINGLE">單牌</option>
              <option value="DUAL">兩地牌</option>
              <option value="TRIPLE">三地牌</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label class="field">香港車牌<input v-model="profileForm.hkPlate" class="input" maxlength="12" /></label>
          <label class="field">澳門車牌<input v-model="profileForm.macauPlate" class="input" maxlength="12" placeholder="AA-00-00" /></label>
          <label class="field">內地車牌<input v-model="profileForm.mainlandPlate" class="input" maxlength="12" placeholder="粵Z·1234港" /></label>
        </div>
        <div class="row">
          <label class="field">車型<input v-model="profileForm.vehicleType" class="input" maxlength="30" required /></label>
          <label class="field">座位<input v-model="profileForm.seats" class="input" type="number" min="1" max="60" /></label>
          <label class="field">車色<input v-model="profileForm.color" class="input" maxlength="20" /></label>
        </div>
        <div class="row">
          <label class="field">港澳號碼<input v-model="profileForm.hkMacauPhone" class="input" placeholder="+852 91234567" /></label>
          <label class="field">內地號碼<input v-model="profileForm.mainlandPhone" class="input" placeholder="+86 13800001111" /></label>
          <label class="field user-profile-form__check"><input v-model="profileForm.hidePlates" type="checkbox" /> 對乘客隱藏車牌</label>
        </div>
        <div class="row">
          <button class="button" type="submit">儲存</button>
          <button class="button secondary" type="button" @click="editingProfile = false">取消</button>
        </div>
      </form>
      <p class="hint">註冊：{{ dateTime(user.createdAt) }}　介面語言：{{ user.locale === 'zh-Hans' ? '簡體' : '繁體' }}</p>
    </div>

    <div class="card">
      <h2>名片頁</h2>
      <p class="hint">有投訴時在這裡查看內容並處理。用戶列表的搜尋框可以直接貼名片頁連結找到司機。</p>
      <p v-if="!user.profilePage" class="muted">還沒有打開過名片頁設定</p>
      <template v-else>
        <div v-if="user.profilePage.blockedAt" class="notice error">
          已於 {{ dateTime(user.profilePage.blockedAt) }} 下架，原因：{{ user.profilePage.blockedReason ?? '—' }}
        </div>
        <div class="row">
          <span>狀態：{{ user.profilePage.blockedAt ? '已下架' : user.profilePage.published ? '已公開' : '未公開' }}</span>
          <span>代碼：{{ user.profilePage.code }}</span>
          <span>收到預約：{{ user.profilePage.bookings }} 個</span>
          <span>微信號：{{ user.profilePage.wechatId ?? '—' }}</span>
          <span>WhatsApp：{{ user.profilePage.whatsapp ?? '—' }}</span>
        </div>
        <p><b>介紹：</b>{{ user.profilePage.intro || '—' }}</p>
        <p><b>路線：</b>{{ user.profilePage.routes.join('、') || '—' }}　<b>語言：</b>{{ user.profilePage.languages.join('、') || '—' }}　<b>服務地區：</b>{{ user.profilePage.regions.join('、') || '—' }}</p>
        <div v-if="user.profilePage.photoIds.length" class="user-media">
          <figure v-for="photoId in user.profilePage.photoIds" :key="photoId" class="user-media__item">
            <a v-if="images[photoPath(photoId)]?.startsWith('blob:')" :href="images[photoPath(photoId)]" target="_blank" rel="noopener">
              <img :src="images[photoPath(photoId)]" alt="車輛照片" />
            </a>
            <span v-else class="user-media__missing">{{ images[photoPath(photoId)] === 'missing' ? '讀取不到照片' : '載入中' }}</span>
            <button v-if="can.write()" class="button secondary" type="button" @click="removePhoto(photoId)">刪除照片</button>
          </figure>
        </div>
        <p v-else class="muted">沒有車輛照片</p>
        <div v-if="can.write()" class="row">
          <button v-if="user.profilePage.blockedAt" class="button" type="button" @click="restorePage">恢復名片頁</button>
          <button v-else class="button danger" type="button" @click="blockPage">下架名片頁</button>
        </div>
      </template>
      <p>收款方式：{{ user.paymentMethods }} 個<span class="hint">　帳號與收款碼只給用戶自己和他選擇顯示的乘客，後台不顯示</span></p>
    </div>

    <div class="card">
      <h2>派單群</h2>
      <p v-if="user.groupInvites.length === 0" class="muted">沒有加入派單群</p>
      <div v-else class="user-media">
        <figure v-for="invite in user.groupInvites" :key="invite.id" class="user-media__item">
          <template v-if="invite.hasQr">
            <a v-if="images[qrPath(invite.id)]?.startsWith('blob:')" :href="images[qrPath(invite.id)]" target="_blank" rel="noopener">
              <img :src="images[qrPath(invite.id)]" alt="二維碼" />
            </a>
            <span v-else class="user-media__missing">{{ images[qrPath(invite.id)] === 'missing' ? '讀取不到二維碼' : '載入中' }}</span>
          </template>
          <figcaption>
            <b>{{ invite.name || GROUP_KIND[invite.platform] }}</b>
            <span class="hint">{{ GROUP_KIND[invite.platform] }}　{{ invite.showOnClaimPage ? '在搶單頁顯示' : '不在搶單頁顯示' }}</span>
            <span v-if="invite.inviteUrl" class="hint">{{ invite.inviteUrl }}</span>
            <span v-if="invite.expiresAt" class="hint">{{ dateTime(invite.expiresAt) }} 過期</span>
          </figcaption>
          <button v-if="can.write()" class="button secondary" type="button" @click="removeGroup(invite.id)">移除</button>
        </figure>
      </div>
    </div>

    <div class="card">
      <h2>通知</h2>
      <p>
        關掉的通知：{{ user.notifications.off.map((group) => NOTIFICATION_GROUP[group] ?? group).join('、') || '沒有' }}
        <span class="hint">　通知只在司機開著頁面時跳出；提示音開關存在司機手機上，後台看不到</span>
      </p>
      <table class="table">
        <thead>
          <tr><th>時間</th><th>通知</th><th>行程</th><th>已讀</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in user.notifications.recent" :key="i">
            <td>{{ dateTime(item.createdAt) }}</td>
            <td>{{ NOTIFICATION_KIND[item.kind] ?? item.kind }}</td>
            <td>{{ item.summary || '—' }}</td>
            <td>{{ item.read ? '已讀' : '未讀' }}</td>
          </tr>
          <tr v-if="user.notifications.recent.length === 0">
            <td colspan="4" class="muted">最近沒有通知</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>點數</h2>
      <form v-if="can.write()" class="row" @submit.prevent="changeCredits">
        <select v-model="credit.type" class="select">
          <option value="TOPUP">人工充值</option>
          <option value="ADJUST">調整（可為負數）</option>
        </select>
        <input v-model="credit.amount" class="input" type="number" step="0.01" placeholder="金額（HK$）" required />
        <input v-model="credit.note" class="input" placeholder="備註，例如：轉數快 #123" required />
        <button class="button" type="submit">確定</button>
      </form>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>時間</th>
              <th>類型</th>
              <th>金額</th>
              <th>餘額</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, i) in user.credits.entries" :key="i">
              <td>{{ dateTime(entry.createdAt) }}</td>
              <td>{{ CREDIT_ENTRY[entry.type] ?? entry.type }}</td>
              <td>{{ hkd(entry.amount) }}</td>
              <td>{{ hkd(entry.balanceAfter) }}</td>
              <td>{{ entry.note ?? '' }}</td>
            </tr>
            <tr v-if="user.credits.entries.length === 0">
              <td colspan="5" class="muted">沒有紀錄</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>方案與贈送</h2>
      <p v-for="sub in user.subscriptions" :key="sub.id">
        訂閱：{{ PLAN_NAME[sub.planKey] ?? sub.planKey }}（{{ sub.source }}，{{ sub.status }}）{{ dateTime(sub.startsAt) }} 至 {{ dateTime(sub.endsAt) }}
      </p>
      <form v-if="can.write()" class="row" @submit.prevent="giftPlan">
        <select v-model="gift.planKey" class="select">
          <option v-for="plan in PLANS" :key="plan.key" :value="plan.key">贈送{{ plan.label }}方案</option>
        </select>
        <label class="field">
          結束時間（留空為不限）
          <input v-model="gift.endsAt" class="input" type="datetime-local" />
        </label>
        <input v-model="gift.reason" class="input" placeholder="原因，例如：Master Travel 客戶" required />
        <button class="button" type="submit">贈送</button>
      </form>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>內容</th>
              <th>開始</th>
              <th>結束</th>
              <th>原因</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in user.overrides" :key="item.id">
              <td>{{ item.planKey ? `方案：${PLAN_NAME[item.planKey] ?? item.planKey}` : `功能：${item.featureKey}` }}{{ item.active ? '（生效中）' : '' }}</td>
              <td>{{ dateTime(item.startsAt) }}</td>
              <td>{{ dateTime(item.endsAt) }}</td>
              <td>{{ item.reason }}</td>
              <td>
                <button v-if="item.active && can.write()" class="button secondary" @click="endOverride(item.id)">結束</button>
              </td>
            </tr>
            <tr v-if="user.overrides.length === 0">
              <td colspan="5" class="muted">沒有贈送</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>

<style scoped>
.user-profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin-top: var(--space-md);
}
.user-media {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin: var(--space-md) 0;
}
.user-media__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 180px;
  margin: 0;
}
.user-media__item img {
  width: 180px;
  height: 135px;
  object-fit: cover;
  border-radius: var(--radius-input);
  background: var(--color-field);
}
.user-media__missing {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 135px;
  border-radius: var(--radius-input);
  background: var(--color-field);
  color: var(--color-text-muted);
}
.user-media__item figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
}
.user-profile-form__check {
  flex-direction: row;
  align-items: center;
  gap: var(--space-sm);
}
</style>
