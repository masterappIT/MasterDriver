<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import PagerBar from '../components/PagerBar.vue';
import { dateTime, hkd, PLATE_TYPE } from '../format';

interface UserRow {
  id: string;
  phone: string;
  name: string | null;
  plates: string[];
  plateType: string | null;
  pagePublished: boolean;
  dispatched: number;
  claimed: number;
  credits: number;
  createdAt: string;
}

const q = ref('');
const page = ref(1);
const result = ref<{ total: number; pageSize: number; items: UserRow[] } | null>(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value), ...(q.value ? { q: q.value } : {}) });
    result.value = await api('GET', `/users?${params}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function search() {
  page.value = 1;
  void load();
}

onMounted(load);
</script>

<template>
  <h1>用戶</h1>
  <div class="card">
    <form class="row" @submit.prevent="search">
      <input v-model="q" class="input" placeholder="手機號碼或姓名" />
      <button class="button" type="submit">搜尋</button>
    </form>
  </div>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="result" class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>手機</th>
          <th>姓名</th>
          <th>車牌</th>
          <th>派單</th>
          <th>接單</th>
          <th>點數</th>
          <th>註冊時間</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in result.items" :key="user.id">
          <td class="nowrap"><RouterLink :to="`/users/${user.id}`">{{ user.phone }}</RouterLink></td>
          <td>{{ user.name ?? '—' }}<span v-if="user.pagePublished" class="hint">　名片頁已公開</span></td>
          <td>{{ user.plates.join(' / ') || '—' }}<span v-if="user.plateType" class="hint">　{{ PLATE_TYPE[user.plateType] }}</span></td>
          <td>{{ user.dispatched }}</td>
          <td>{{ user.claimed }}</td>
          <td>{{ hkd(user.credits) }}</td>
          <td class="nowrap">{{ dateTime(user.createdAt) }}</td>
        </tr>
        <tr v-if="result.items.length === 0">
          <td colspan="7" class="muted">沒有符合的用戶</td>
        </tr>
      </tbody>
    </table>
    <PagerBar :page="page" :page-size="result.pageSize" :total="result.total" @change="(p) => ((page = p), load())" />
  </div>
</template>
