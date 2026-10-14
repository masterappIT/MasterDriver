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
  <h1>操作紀錄</h1>
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
          <th>對象</th>
          <th>內容</th>
          <th>IP</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in result.items" :key="entry.id">
          <td class="nowrap">{{ dateTime(entry.createdAt) }}</td>
          <td>{{ entry.admin?.displayName ?? '—' }}</td>
          <td>{{ ACTION[entry.action] ?? entry.action }}</td>
          <td>
            <RouterLink v-if="entry.targetType === 'user'" :to="`/users/${entry.targetId}`">用戶</RouterLink>
            <RouterLink v-else-if="entry.targetType === 'order'" :to="`/orders/${entry.targetId}`">訂單</RouterLink>
            <span v-else>{{ entry.targetId ?? '' }}</span>
          </td>
          <td class="hint">{{ entry.detail ? JSON.stringify(entry.detail) : '' }}</td>
          <td class="hint">{{ entry.ip ?? '' }}</td>
        </tr>
      </tbody>
    </table>
    <PagerBar :page="page" :page-size="result.pageSize" :total="result.total" @change="(p) => ((page = p), load())" />
  </div>
</template>
