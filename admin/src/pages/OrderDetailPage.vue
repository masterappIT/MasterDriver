<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, can } from '../api';
import BackLink from '../components/BackLink.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { ask, notify } from '../feedback';
import { dateTime, hkd, money, PLATE_TYPE } from '../format';

type Money = { amount: number; currency: string } | null;

interface OrderDetail {
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
  driverPrice: Money;
  passengerPrice: Money;
  showPassengerPrice: boolean;
  margin: Money;
  serviceFee: number | null;
  passenger: { name: string | null; contact: string } | null;
  dispatcher: { id: string; name: string | null; phone: string };
  selfDrive: boolean;
  inPool: boolean;
  /** kind: TRANSFER (接駁) or ROUND_TRIP (往返); sameDriver: one driver takes both legs of a 往返. */
  journey: { kind: 'TRANSFER' | 'ROUND_TRIP'; sameDriver: boolean; legIndex: number; legCount: number } | null;
  /** 包鐘: the hours booked and the prices an hour; the order's prices are those times the hours. */
  charter: { minutes: number; driverHourly: Money | null; passengerHourly: Money | null } | null;
  contactRevealMinutes: number | null;
  fromBooking: boolean;
  payment: { showPaymentMethods: boolean; paidAt: string | null; settledAt: string | null };
  tripGroup: { platform: 'WHATSAPP' | 'WECHAT'; expiresAt: string | null } | null;
  /** Taken by a driver whose account was deleted since. */
  driverDeleted: boolean;
  driver: {
    id: string;
    name: string | null;
    phone: string;
    profile: {
      hkPlate: string | null;
      macauPlate: string | null;
      mainlandPlate: string | null;
      plateType: string | null;
      vehicleType: string | null;
      color: string | null;
      hkMacauPhone: string | null;
      mainlandPhone: string | null;
      hidePlates: boolean;
    } | null;
  } | null;
  /** 出單者代確認: the dispatcher, not the passenger, confirmed the trip. */
  passengerConfirmedByDispatcher?: boolean;
  timeline: Record<string, string | null>;
  claims: { result: string; createdAt: string; driver: { id: string; name: string | null; phone: string } }[];
}

const TIMELINE: Record<string, string> = {
  createdAt: '出單',
  claimedAt: '被搶到',
  passengerConfirmedAt: '乘客確認',
  completedAt: '完成',
  cancelledAt: '取消',
};

/** When the driver may see the passenger's phone, as the dispatcher set it. */
function revealText(minutes: number | null): string {
  if (minutes === null) return '搶到即顯示';
  return minutes % 60 === 0 ? `出發前 ${minutes / 60} 小時` : `出發前 ${minutes} 分鐘`;
}

/** The driver's other numbers, beyond the one they sign in with. */
function otherPhones(driver: NonNullable<OrderDetail['driver']>): string {
  return [driver.profile?.hkMacauPhone, driver.profile?.mainlandPhone].filter((phone) => phone && phone !== driver.phone).join('、');
}

const route = useRoute();
const router = useRouter();
const order = ref<OrderDetail | null>(null);
const error = ref('');
const busy = ref(false);

/** 代為取消: for a complaint or an abandoned order. It runs as the dispatcher's own cancel, and the reason is logged. */
async function cancelForDispatcher() {
  const reason = await ask({
    title: '代出單者取消這張單',
    text: '服務費會照規則退回；接單司機和乘客打開連結會看到已取消。',
    reason: '原因（會記在操作紀錄）',
    confirm: '取消這張單',
    danger: true,
  });
  if (!reason) return;
  busy.value = true;
  try {
    order.value = await api<OrderDetail>('POST', `/orders/${route.params.id}/cancel`, { reason });
    notify('已取消這張單');
  } catch (e) {
    notify((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}

/** 用客服聯絡: opens that person's 客服 conversation, for a dispute or a complaint about this order. */
async function contact(userId: string) {
  try {
    const { id } = await api<{ id: string }>('POST', '/support/conversations', { userId });
    await router.push(`/support/${id}`);
  } catch (e) {
    notify((e as Error).message, true);
  }
}

onMounted(async () => {
  try {
    order.value = await api<OrderDetail>('GET', `/orders/${route.params.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <BackLink to="/orders" label="返回訂單" />
  <div v-if="error" class="notice error">{{ error }}</div>
  <template v-if="order">
    <div class="page-head">
      <div class="page-head__title">
        <h1>{{ order.origin }} 至 {{ order.destination }}</h1>
        <StatusBadge :status="order.status" />
      </div>
      <button
        v-if="can.write() && (order.status === 'OPEN' || order.status === 'ASSIGNED')"
        class="button danger"
        type="button"
        :disabled="busy"
        @click="cancelForDispatcher"
      >
        代出單者取消這張單
      </button>
    </div>

    <div class="card">
      <dl class="facts">
        <div><dt>出發</dt><dd>{{ dateTime(order.pickupAt) }}</dd></div>
        <div><dt>單號</dt><dd>{{ order.code }}</dd></div>
        <div><dt>人數與行李</dt><dd>{{ order.passengers }} 人・{{ order.luggage }} 件行李</dd></div>
        <div><dt>車型</dt><dd>{{ order.vehicleType ?? '—' }}</dd></div>
        <div v-if="order.waypoints.length" class="facts__wide"><dt>途經</dt><dd>{{ order.waypoints.join('、') }}</dd></div>
        <div v-if="order.notes" class="facts__wide"><dt>備註</dt><dd>{{ order.notes }}</dd></div>
      </dl>
      <div class="order-detail__tags">
        <span v-if="order.journey?.kind === 'ROUND_TRIP'" class="tag">往返{{ order.journey.legIndex === 1 ? '去程' : '回程' }}{{ order.journey.sameDriver ? '・同一位司機來回' : '・可分開接' }}</span>
        <span v-else-if="order.journey" class="tag">接駁第 {{ order.journey.legIndex }}／{{ order.journey.legCount }} 段</span>
        <span v-if="order.charter" class="tag">包鐘 {{ order.charter.minutes / 60 }} 小時</span>
        <span v-if="order.selfDrive" class="tag">出單者自己做</span>
        <span v-if="order.inPool" class="tag">在接單池</span>
        <span v-if="order.fromBooking" class="tag">來自名片頁預約</span>
        <span v-if="order.tripGroup" class="tag">
          有行程群（{{ order.tripGroup.platform === 'WHATSAPP' ? 'WhatsApp' : `微信，${dateTime(order.tripGroup.expiresAt)} 前有效` }}）
        </span>
      </div>
    </div>

    <div class="card">
      <dl class="facts facts--numbers">
        <div><dt>出單價</dt><dd>{{ money(order.driverPrice) }}<template v-if="order.charter?.driverHourly">（每小時 {{ money(order.charter.driverHourly) }}）</template></dd></div>
        <div>
          <dt>乘客價<span class="tag">{{ order.showPassengerPrice ? '乘客看得到' : '乘客看不到' }}</span></dt>
          <dd>{{ money(order.passengerPrice) }}</dd>
        </div>
        <div><dt>差價</dt><dd>{{ money(order.margin) }}</dd></div>
        <div><dt>平台服務費</dt><dd>{{ hkd(order.serviceFee) }}</dd></div>
      </dl>
    </div>

    <div class="split order-detail__split">
      <div class="card">
        <h2>相關人員</h2>
        <dl class="facts order-detail__people">
          <div class="facts__wide">
            <dt>出單者</dt>
            <dd>
              <RouterLink :to="`/users/${order.dispatcher.id}`">{{ order.dispatcher.name ?? '未填姓名' }}（{{ order.dispatcher.phone }}）</RouterLink>
              <button v-if="can.write()" class="order-detail__contact" type="button" @click="contact(order.dispatcher.id)">用客服聯絡</button>
            </dd>
          </div>
          <div v-if="order.driverDeleted" class="facts__wide">
            <dt>接單司機</dt>
            <dd class="muted">司機已刪除</dd>
          </div>
          <div v-if="order.driver" class="facts__wide">
            <dt>接單司機</dt>
            <dd>
              <RouterLink :to="`/users/${order.driver.id}`">{{ order.driver.name ?? '未填姓名' }}（{{ order.driver.phone }}）</RouterLink>
              <button v-if="can.write()" class="order-detail__contact" type="button" @click="contact(order.driver.id)">用客服聯絡</button>
              <span class="muted">
                {{ [order.driver.profile?.hkPlate, order.driver.profile?.macauPlate, order.driver.profile?.mainlandPlate].filter(Boolean).join(' / ') }}
              </span>
              <span class="hint order-detail__more">
                {{
                  [
                    order.driver.profile?.vehicleType,
                    order.driver.profile?.color,
                    order.driver.profile?.plateType ? PLATE_TYPE[order.driver.profile.plateType] : null,
                    otherPhones(order.driver) ? `其他號碼 ${otherPhones(order.driver)}` : null,
                    order.driver.profile?.hidePlates ? '對乘客隱藏車牌' : null,
                  ]
                    .filter(Boolean)
                    .join('・')
                }}
              </span>
            </dd>
          </div>
          <div class="facts__wide">
            <dt>乘客</dt>
            <dd v-if="order.passenger">{{ order.passenger.name ?? '—' }}（{{ order.passenger.contact }}）<span class="hint order-detail__more">查看乘客資料已記錄在操作紀錄</span></dd>
            <dd v-else class="muted">你的角色看不到乘客資料</dd>
          </div>
        </dl>
        <p class="hint order-detail__foot">接單司機看到乘客電話的時間：{{ revealText(order.contactRevealMinutes) }}；行程完成或取消後不再顯示。</p>
      </div>

      <div class="card">
        <h2>時間線</h2>
        <ul class="timeline">
          <li v-for="(label, key) in TIMELINE" :key="key" :class="{ pending: !order.timeline[key] }">
            <span>{{ key === 'passengerConfirmedAt' && order.passengerConfirmedByDispatcher ? '出單者代乘客確認' : label }}</span>
            <span>{{ dateTime(order.timeline[key]) }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="card">
      <h2>收款與結清</h2>
      <p class="hint">以下都是出單者自己的選擇和記號。乘客直接付給出單者，司機之間自己結，平台不經手、不核對。</p>
      <dl class="facts">
        <div><dt>乘客確認頁顯示收款方式</dt><dd>{{ order.payment.showPaymentMethods ? '是' : '否' }}</dd></div>
        <div>
          <dt>車費</dt>
          <dd :class="{ muted: !order.payment.paidAt }">{{ order.payment.paidAt ? `${dateTime(order.payment.paidAt)} 標記已收款` : '未標記收款' }}</dd>
        </div>
        <div v-if="!order.selfDrive">
          <dt>和接單司機的帳</dt>
          <dd :class="{ muted: !order.payment.settledAt }">
            {{ order.payment.settledAt ? `${dateTime(order.payment.settledAt)} 標記已結清` : order.status === 'COMPLETED' ? '未標記結清' : '完成後才能標記' }}
          </dd>
        </div>
      </dl>
    </div>

    <div class="card table-wrap">
      <h2>搶單紀錄</h2>
      <table class="table">
        <thead>
          <tr>
            <th>時間</th>
            <th>司機</th>
            <th>結果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(claim, i) in order.claims" :key="i">
            <td class="nowrap">{{ dateTime(claim.createdAt) }}</td>
            <td><RouterLink :to="`/users/${claim.driver.id}`">{{ claim.driver.name ?? '未填姓名' }}（{{ claim.driver.phone }}）</RouterLink></td>
            <td><span class="tag" :class="{ 'tag--info': claim.result === 'WON' }">{{ claim.result === 'WON' ? '搶到' : '落空' }}</span></td>
          </tr>
          <tr v-if="order.claims.length === 0">
            <td colspan="3" class="muted">還沒有人搶單</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
/* 相關人員 and 時間線 side by side are as tall as each other. */
.order-detail__split {
  align-items: stretch;
}

.order-detail__contact {
  margin-left: var(--space-sm);
  padding: 1px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-label);
  background: var(--color-surface);
  font-size: var(--font-caption);
  font-weight: 600;
  vertical-align: 1px;
}
.order-detail__contact:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.order-detail__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}
.order-detail__tags:empty {
  display: none;
}
.order-detail__tags .tag {
  margin-left: 0;
}
.order-detail__more {
  display: block;
}
.order-detail__foot {
  display: block;
  margin: var(--space-md) 0 0;
}
</style>
