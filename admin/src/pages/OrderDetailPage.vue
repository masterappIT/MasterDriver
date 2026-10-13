<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, can } from '../api';
import StatusBadge from '../components/StatusBadge.vue';
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
  journey: { legIndex: number; legCount: number } | null;
  contactRevealMinutes: number | null;
  fromBooking: boolean;
  payment: { showPaymentMethods: boolean; paidAt: string | null; settledAt: string | null };
  tripGroup: { platform: 'WHATSAPP' | 'WECHAT'; expiresAt: string | null } | null;
  driver: {
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
const order = ref<OrderDetail | null>(null);
const error = ref('');

const message = ref('');
const busy = ref(false);

/** 代為取消: for a complaint or an abandoned order. It runs as the dispatcher's own cancel, and the reason is logged. */
async function cancelForDispatcher() {
  const reason = prompt('代出單者取消這張單。服務費會照規則退回，接單司機和乘客打開連結會看到已取消。\n請寫原因（會記在操作紀錄）：')?.trim();
  if (!reason) return;
  error.value = '';
  message.value = '';
  busy.value = true;
  try {
    order.value = await api<OrderDetail>('POST', `/orders/${route.params.id}/cancel`, { reason });
    message.value = '已取消這張單';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
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
  <RouterLink to="/orders" class="hint">返回訂單</RouterLink>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <template v-if="order">
    <h1>{{ order.origin }} 至 {{ order.destination }}　<StatusBadge :status="order.status" /></h1>
    <p v-if="can.write() && (order.status === 'OPEN' || order.status === 'ASSIGNED')">
      <button class="button danger" type="button" :disabled="busy" @click="cancelForDispatcher">代出單者取消這張單</button>
    </p>
    <div class="card">
      <div class="row">
        <span>出發：{{ dateTime(order.pickupAt) }}</span>
        <span>單號：{{ order.code }}</span>
        <span>{{ order.passengers }} 人・{{ order.luggage }} 件行李{{ order.vehicleType ? `・${order.vehicleType}` : '' }}</span>
      </div>
      <div class="row order-detail__tags">
        <span v-if="order.journey" class="order-detail__tag">接駁第 {{ order.journey.legIndex }}／{{ order.journey.legCount }} 段</span>
        <span v-if="order.selfDrive" class="order-detail__tag">出單者自己做</span>
        <span v-if="order.inPool" class="order-detail__tag">在接單池</span>
        <span v-if="order.fromBooking" class="order-detail__tag">來自名片頁預約</span>
        <span v-if="order.tripGroup" class="order-detail__tag">
          有行程群（{{ order.tripGroup.platform === 'WHATSAPP' ? 'WhatsApp' : `微信，${dateTime(order.tripGroup.expiresAt)} 前有效` }}）
        </span>
      </div>
      <p v-if="order.waypoints.length">途經：{{ order.waypoints.join('、') }}</p>
      <p v-if="order.notes">備註：{{ order.notes }}</p>
    </div>

    <div class="grid">
      <div class="card">
        <div class="muted">出單價</div>
        <div class="stat">{{ money(order.driverPrice) }}</div>
      </div>
      <div class="card">
        <div class="muted">乘客價</div>
        <div class="stat">{{ money(order.passengerPrice) }}</div>
        <div class="hint">{{ order.showPassengerPrice ? '乘客看得到' : '乘客看不到' }}</div>
      </div>
      <div class="card">
        <div class="muted">差價</div>
        <div class="stat">{{ money(order.margin) }}</div>
      </div>
      <div class="card">
        <div class="muted">平台服務費</div>
        <div class="stat">{{ hkd(order.serviceFee) }}</div>
      </div>
    </div>

    <div class="card">
      <h2>收款與結清</h2>
      <p class="hint">以下都是出單者自己的選擇和記號。乘客直接付給出單者，司機之間自己結，平台不經手、不核對。</p>
      <div class="row">
        <span>乘客確認頁顯示收款方式：{{ order.payment.showPaymentMethods ? '是' : '否' }}</span>
        <span :class="{ muted: !order.payment.paidAt }">車費：{{ order.payment.paidAt ? `${dateTime(order.payment.paidAt)} 標記已收款` : '未標記收款' }}</span>
        <span v-if="!order.selfDrive" :class="{ muted: !order.payment.settledAt }">
          和接單司機的帳：{{ order.payment.settledAt ? `${dateTime(order.payment.settledAt)} 標記已結清` : order.status === 'COMPLETED' ? '未標記結清' : '完成後才能標記' }}
        </span>
      </div>
    </div>

    <div class="card">
      <h2>相關人員</h2>
      <p>
        出單者：<RouterLink :to="`/users/${order.dispatcher.id}`">{{ order.dispatcher.name ?? '未填姓名' }}（{{ order.dispatcher.phone }}）</RouterLink>
      </p>
      <p v-if="order.driver">
        接單司機：{{ order.driver.name ?? '未填姓名' }}（{{ order.driver.phone }}）
        <span class="muted">
          {{ [order.driver.profile?.hkPlate, order.driver.profile?.macauPlate, order.driver.profile?.mainlandPlate].filter(Boolean).join(' / ') }}
        </span>
        <span class="hint">
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
      </p>
      <p v-if="order.passenger">乘客：{{ order.passenger.name ?? '—' }}（{{ order.passenger.contact }}）<span class="hint">查看乘客資料已記錄在操作紀錄</span></p>
      <p v-else class="muted">你的角色看不到乘客資料</p>
      <p class="hint">接單司機看到乘客電話的時間：{{ revealText(order.contactRevealMinutes) }}；行程完成或取消後不再顯示。</p>
    </div>

    <div class="card">
      <h2>時間線</h2>
      <div class="row">
        <span v-for="(label, key) in TIMELINE" :key="key" :class="{ muted: !order.timeline[key] }">
          {{ label }}：{{ dateTime(order.timeline[key]) }}
        </span>
      </div>
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
            <td>{{ dateTime(claim.createdAt) }}</td>
            <td><RouterLink :to="`/users/${claim.driver.id}`">{{ claim.driver.name ?? '未填姓名' }}（{{ claim.driver.phone }}）</RouterLink></td>
            <td>{{ claim.result === 'WON' ? '搶到' : '落空' }}</td>
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
.order-detail__tags:empty {
  display: none;
}
.order-detail__tag {
  padding: 2px var(--space-sm);
  border-radius: 100px;
  background: var(--color-tint, #e5edfb);
  font-size: var(--font-label, 13px);
}
</style>
