<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import PagerBar from '../components/PagerBar.vue';
import { dateTime, hkd, PLATE_TYPE } from '../format';
import { useListQuery, useRowLink } from '../list-query';

interface UserRow {
  id: string;
  phone: string;
  name: string | null;
  plates: string[];
  plateType: string | null;
  pagePublished: boolean;
  suspended: boolean;
  dispatched: number;
  claimed: number;
  credits: number;
  createdAt: string;
}

const STATUS: Record<string, string> = {
  DRIVER: '已填司機資料',
  NO_PROFILE: '未填司機資料',
  PAGE_PUBLISHED: '名片頁已公開',
  SUSPENDED: '已停用',
};

const result = ref<{ total: number; pageSize: number; items: UserRow[] } | null>(null);
const error = ref('');
const loading = ref(false);
const rowLink = useRowLink();

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
</script>

<template>
  <div class="page-head">
    <div class="page-head__title">
      <h1>用戶</h1>
      <span v-if="result" class="muted">共 {{ result.total }} 位{{ list.filtered.value ? '符合' : '' }}</span>
    </div>
  </div>
  <form class="filters" @submit.prevent="list.apply()">
    <input v-model="filters.q" class="input" type="search" placeholder="手機號碼、姓名、名片頁連結或帳戶 ID" />
    <select v-model="filters.status" class="select" aria-label="狀態" @change="list.apply()">
      <option value="">全部用戶</option>
      <option v-for="(label, key) in STATUS" :key="key" :value="key">{{ label }}</option>
    </select>
    <button class="button secondary" type="submit">搜尋</button>
    <button v-if="list.filtered.value" class="filters__clear" type="button" @click="list.clear()">清除篩選</button>
  </form>
  <div v-if="error" class="notice error">{{ error }} <button class="button secondary" type="button" @click="list.goTo(list.page.value)">重試</button></div>
  <div v-if="result" class="card table-wrap" :class="{ 'is-loading': loading }">
    <table class="table table--links">
      <thead>
        <tr>
          <th>用戶</th>
          <th>車牌</th>
          <th>狀態</th>
          <th class="num">派單</th>
          <th class="num">接單</th>
          <th class="num">點數</th>
          <th>註冊時間</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in result.items" :key="user.id" @click="rowLink(`/users/${user.id}`)($event)">
          <td class="nowrap">
            <RouterLink :to="`/users/${user.id}`" class="cell-title">{{ user.name ?? '未填姓名' }}</RouterLink>
            <div class="hint">{{ user.phone }}</div>
          </td>
          <td>
            {{ user.plates.join(' / ') || '—' }}
            <div v-if="user.plateType" class="hint">{{ PLATE_TYPE[user.plateType] }}</div>
          </td>
          <td>
            <span v-if="user.suspended" class="tag tag--danger">已停用</span>
            <span v-if="user.pagePublished" class="tag tag--info">名片頁已公開</span>
            <span v-if="!user.suspended && !user.pagePublished" class="muted">—</span>
          </td>
          <td class="num">{{ user.dispatched }}</td>
          <td class="num">{{ user.claimed }}</td>
          <td class="num">{{ hkd(user.credits) }}</td>
          <td class="nowrap">{{ dateTime(user.createdAt) }}</td>
        </tr>
        <tr v-if="result.items.length === 0" class="table__empty">
          <td colspan="7" class="muted">
            沒有符合的用戶。<button v-if="list.filtered.value" class="filters__clear" type="button" @click="list.clear()">清除篩選</button>
          </td>
        </tr>
      </tbody>
    </table>
    <PagerBar :page="list.page.value" :page-size="result.pageSize" :total="result.total" @change="list.goTo" />
  </div>
  <p v-else-if="loading" class="card muted">載入中…</p>
</template>
