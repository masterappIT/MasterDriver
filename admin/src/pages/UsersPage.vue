<script setup lang="ts">
import { ref } from 'vue';
import { api, can } from '../api';
import UserDrawer from '../components/UserDrawer.vue';
import { ask, notify } from '../feedback';
import { dateTime, hkd, PLATE_TYPE } from '../format';
import { useDrawer, useListQuery } from '../list-query';
import PagerBar from '../components/PagerBar.vue';

/**
 * 用戶. The layout is Master Travel's user management (admin/src/pages/users/UsersPage.js and
 * styles/users.css at c902bb5a, docs/REUSE.md): counts that filter, a toolbar, a list whose rows open
 * the details in a drawer, and actions on each row. What it lists and does is this project's.
 */
interface UserRow {
  id: string;
  phone: string;
  name: string | null;
  plates: string[];
  plateType: string | null;
  vehicleType: string | null;
  pagePublished: boolean;
  suspended: boolean;
  dispatched: number;
  claimed: number;
  credits: number;
  createdAt: string;
}

interface UserList {
  total: number;
  pageSize: number;
  summary: { all: number; drivers: number; published: number; suspended: number };
  items: UserRow[];
}

const STATUS: Record<string, string> = {
  DRIVER: '已填司機資料',
  NO_PROFILE: '未填司機資料',
  PAGE_PUBLISHED: '名片頁已公開',
  SUSPENDED: '已停用',
};

const result = ref<UserList | null>(null);
const error = ref('');
const loading = ref(false);

const list = useListQuery({ q: '', status: '' }, async (query) => {
  error.value = '';
  loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(query.page) });
    if (query.q) params.set('q', query.q);
    if (query.status) params.set('status', query.status);
    result.value = await api('GET', `/users?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
const { filters } = list;
const drawer = useDrawer();

const initial = (user: UserRow) => (user.name || user.phone.replace(/\D/g, '').slice(-2) || '?').slice(0, 1).toUpperCase();

/** A card above the list: its count, and the filter it stands for (clicking the one on takes it off). */
function pick(status: string) {
  list.apply({ status: filters.status === status ? '' : status });
}

async function suspend(user: UserRow) {
  const reason = await ask({
    title: '停用這個帳號',
    text: `「${user.name ?? user.phone}」會立即被登出，之後不能再登入，直到恢復。已出的單不會自動取消。`,
    reason: '原因（會記在操作紀錄）',
    confirm: '停用帳號',
    danger: true,
  });
  if (!reason) return;
  await act(() => api('POST', `/users/${user.id}/suspend`, { reason }), '帳號已停用');
}

async function restore(user: UserRow) {
  if ((await ask({ title: '恢復這個帳號', text: `「${user.name ?? user.phone}」可以再登入。`, confirm: '恢復帳號' })) === null) return;
  await act(() => api('POST', `/users/${user.id}/restore`), '帳號已恢復');
}

async function act(action: () => Promise<unknown>, done: string) {
  try {
    await action();
    notify(done);
    list.reload();
  } catch (e) {
    notify((e as Error).message, true);
  }
}
</script>

<template>
  <section class="mt-page">
    <div class="page-head">
      <div>
        <div class="page-head__title">
          <h1>用戶</h1>
          <span v-if="result" class="muted">{{ list.filtered.value ? '符合' : '共' }} {{ result.total }} 位</span>
        </div>
        <p class="page-head__desc">查看司機資料、名片頁、訂單與點數，處理投訴與帳號狀態。</p>
      </div>
    </div>

    <div class="mt-stats">
      <button type="button" class="mt-stat" :class="{ 'is-active': !filters.status }" @click="list.apply({ status: '' })">
        <span>用戶總數</span><strong>{{ result?.summary.all ?? '—' }}</strong><small>全部帳號</small>
      </button>
      <button type="button" class="mt-stat" :class="{ 'is-active': filters.status === 'DRIVER' }" @click="pick('DRIVER')">
        <span>已填司機資料</span><strong>{{ result?.summary.drivers ?? '—' }}</strong><small>可以搶單</small>
      </button>
      <button type="button" class="mt-stat" :class="{ 'is-active': filters.status === 'PAGE_PUBLISHED' }" @click="pick('PAGE_PUBLISHED')">
        <span>名片頁已公開</span><strong>{{ result?.summary.published ?? '—' }}</strong><small>乘客打得開</small>
      </button>
      <button type="button" class="mt-stat" :class="{ 'is-active': filters.status === 'SUSPENDED' }" @click="pick('SUSPENDED')">
        <span>已停用</span><strong>{{ result?.summary.suspended ?? '—' }}</strong><small>需要跟進</small>
      </button>
    </div>

    <div class="mt-panel">
      <div class="mt-toolbar">
        <form class="mt-filters" @submit.prevent="list.apply()">
          <label class="mt-search">
            <span aria-hidden="true">⌕</span>
            <input v-model="filters.q" type="search" placeholder="手機號碼、姓名、名片頁連結或 ID" aria-label="搜尋用戶" />
          </label>
          <select v-model="filters.status" aria-label="用戶狀態" @change="list.apply()">
            <option value="">全部狀態</option>
            <option v-for="(label, key) in STATUS" :key="key" :value="key">{{ label }}</option>
          </select>
          <button v-if="list.filtered.value" type="button" class="mt-clear" @click="list.clear()">清除篩選</button>
        </form>
      </div>

      <div v-if="error" class="mt-summary">
        <span class="users__error">{{ error }}</span>
        <button type="button" class="mt-action" @click="list.reload()">重試</button>
      </div>

      <div class="mt-table-wrap" :class="{ 'is-loading': loading && result }">
        <table class="mt-table">
          <thead>
            <tr>
              <th>用戶</th>
              <th>聯絡電話</th>
              <th>車輛</th>
              <th class="num">派單／接單</th>
              <th class="num col-wide">點數</th>
              <th>狀態</th>
              <th class="col-wide">加入日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in result?.items ?? []"
              :key="user.id"
              class="mt-row"
              :class="{ 'is-selected': drawer.openId.value === user.id }"
              @click="drawer.open(user.id)"
            >
              <td>
                <div class="mt-identity">
                  <span class="mt-avatar" aria-hidden="true">{{ initial(user) }}</span>
                  <div>
                    <strong>{{ user.name ?? '未填姓名' }}</strong>
                    <small :title="user.id">{{ user.id }}</small>
                  </div>
                </div>
              </td>
              <td class="users__nowrap">
                {{ user.phone }}
                <small class="narrow-only">{{ dateTime(user.createdAt) }} 加入</small>
              </td>
              <td>
                <span v-for="plate in user.plates" :key="plate" class="users__plate">{{ plate }}</span>
                <template v-if="user.plates.length === 0">—</template>
                <small v-if="user.vehicleType || user.plateType" class="users__nowrap">{{ [user.vehicleType, user.plateType ? PLATE_TYPE[user.plateType] : null].filter(Boolean).join(' · ') }}</small>
              </td>
              <td class="num">
                {{ user.dispatched }} / {{ user.claimed }}
                <small class="narrow-only">點數 {{ hkd(user.credits) }}</small>
              </td>
              <td class="num col-wide">{{ hkd(user.credits) }}</td>
              <td>
                <div class="users__tags">
                  <span class="mt-status" :class="user.suspended ? 'cancelled' : 'completed'">{{ user.suspended ? '已停用' : '使用中' }}</span>
                  <span v-if="user.pagePublished" class="mt-status confirmed">名片頁</span>
                </div>
              </td>
              <td class="users__nowrap col-wide">{{ dateTime(user.createdAt) }}</td>
              <td class="mt-actions" @click.stop>
                <button type="button" @click="drawer.open(user.id)">查看</button>
                <template v-if="can.write()">
                  <button v-if="user.suspended" type="button" class="is-restore" @click="restore(user)">恢復</button>
                  <button v-else type="button" class="is-danger" @click="suspend(user)">停用</button>
                </template>
              </td>
            </tr>
            <tr v-if="result && result.items.length === 0">
              <td colspan="8" class="mt-empty">
                <strong>{{ list.filtered.value ? '找不到符合條件的用戶' : '目前沒有用戶資料' }}</strong>
                <span v-if="list.filtered.value">請調整搜尋關鍵字或狀態篩選。</span>
              </td>
            </tr>
            <tr v-if="!result && loading">
              <td colspan="8" class="mt-empty"><span>載入中…</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <PagerBar v-if="result" :page="list.page.value" :page-size="result.pageSize" :total="result.total" @change="list.goTo" />
    </div>

    <UserDrawer v-if="drawer.openId.value" :user-id="drawer.openId.value" @close="drawer.close()" @changed="list.reload()" />
  </section>
</template>

<style scoped>
.users__nowrap {
  white-space: nowrap;
}

/* One plate a line: a plate never breaks in the middle. */
.users__plate {
  display: block;
  white-space: nowrap;
}

/* The state, and 名片頁 under it, so the column stays narrow. */
.users__tags {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.users__tags .mt-status + .mt-status {
  margin-left: 0;
}
.users__error {
  color: var(--color-danger-text);
}
</style>
