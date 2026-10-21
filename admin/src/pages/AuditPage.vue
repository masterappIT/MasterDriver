<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import PagerBar from '../components/PagerBar.vue';
import { dateTime } from '../format';

interface Entry {
  id: string;
  action: string;
  admin: { username: string; displayName: string } | null;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

const ACTION: Record<string, string> = {
  'admin.login': '登入',
  'admin.login.failed': '登入失敗',
  'admin.logout': '登出',
  'admin.password.change': '修改密碼',
  'admin.account.create': '新增帳號',
  'admin.account.resetPassword': '重設密碼',
  'admin.account.disable': '停用帳號',
  'admin.account.enable': '啟用帳號',
  'credits.topup': '人工充值',
  'credits.adjust': '調整點數',
  'entitlement.override.create': '贈送方案或功能',
  'entitlement.override.end': '結束贈送',
  'billing.plan.feature': '修改方案內容',
  'billing.policy.create': '新增免費期',
  'billing.policy.update': '修改免費期',
  'billing.serviceFee': '修改平台服務費',
  'settings.developmentLogin': '修改開發模式登入',
  'order.viewPassenger': '查看乘客資料',
  'settings.general': '修改一般設定',
  'seo.site': '修改 SEO 網站設定',
  'seo.page': '修改頁面 SEO',
  'ads.create': '新增廣告',
  'ads.update': '修改廣告',
  'ads.delete': '刪除廣告',
  'leads.update': '更新潛在客戶跟進',
  'channels.stripe.save': '修改 Stripe 設定',
  'channels.stripe.test': '檢查 Stripe 連線',
  'channels.alipayhk.save': '修改 AlipayHK 設定',
  'channels.alipayhk.test': '檢查 AlipayHK 金鑰',
  'channels.payment.enable': '啟用付款通道',
  'channels.payment.disable': '停用付款通道',
  'channels.sms.save': '修改簡訊通道',
  'channels.sms.test': '檢查簡訊連線',
  'channels.sms.testSend': '發送測試簡訊',
  'support.open': '客服主動聯絡',
  'support.reply': '客服回覆',
  'support.handled': '客服標記不用回覆',
  'support.delete': '刪除客服對話',
  'user.suspend': '停用用戶',
  'user.restore': '恢復用戶',
  'user.delete': '刪除用戶',
  'user.profile.update': '代改司機資料',
  'order.cancel': '代出單者取消訂單',
  'profile-page.block': '下架名片頁',
  'profile-page.restore': '恢復名片頁',
  'profile-page.photo.remove': '刪除名片頁照片',
  'group-invite.remove': '移除派單群',
  'settings.limits': '修改防濫用設定',
  'settings.logo': '修改 Logo',
  'settings.updateNotice': '修改更新說明彈窗',
  'channels.spug.save': '修改 Spug 設定',
  'channels.spug.testSend': 'Spug 發送測試簡訊',
};

const action = ref('');
const page = ref(1);
const result = ref<{ total: number; pageSize: number; items: Entry[] } | null>(null);
const error = ref('');

async function load() {
  try {
    const params = new URLSearchParams({ page: String(page.value), ...(action.value ? { action: action.value } : {}) });
    result.value = await api('GET', `/audit?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-head">
    <div class="page-head__title">
      <h1>操作紀錄</h1>
      <span v-if="result" class="muted">{{ action ? '符合' : '共' }} {{ result.total }} 筆</span>
    </div>
  </div>
  <div class="filters">
    <select v-model="action" class="select" @change="(page = 1), load()">
      <option value="">全部操作</option>
      <option v-for="(label, key) in ACTION" :key="key" :value="key">{{ label }}</option>
    </select>
  </div>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="result" class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>時間</th>
          <th>操作者</th>
          <th>操作</th>
          <th class="audit__target">對象</th>
          <th class="audit__detail">內容</th>
          <th>IP</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in result.items" :key="entry.id">
          <td class="nowrap">{{ dateTime(entry.createdAt) }}</td>
          <td class="nowrap">{{ entry.admin?.displayName ?? '—' }}</td>
          <td class="nowrap">{{ ACTION[entry.action] ?? entry.action }}</td>
          <td class="audit__target">
            <RouterLink v-if="entry.targetType === 'user'" :to="`/users/${entry.targetId}`">用戶</RouterLink>
            <RouterLink v-else-if="entry.targetType === 'order'" :to="`/orders/${entry.targetId}`">訂單</RouterLink>
            <span v-else class="clip" :title="entry.targetId ?? undefined">{{ entry.targetId ?? '' }}</span>
          </td>
          <td class="hint break audit__detail">{{ entry.detail ? JSON.stringify(entry.detail) : '' }}</td>
          <td class="hint nowrap">{{ entry.ip ?? '' }}</td>
        </tr>
      </tbody>
    </table>
    <PagerBar :page="page" :page-size="result.pageSize" :total="result.total" @change="(p) => ((page = p), load())" />
  </div>
</template>

<style scoped>
/* 內容 takes the room the other columns do not need, so 操作 and IP sit beside it, not across the card. */
.audit__detail {
  width: 100%;
  min-width: 220px;
}

/* 用戶, 訂單 or an ID on one line; a long ID is cut, its whole value in its title. */
.audit__target {
  min-width: 120px;
  white-space: nowrap;
}
</style>
