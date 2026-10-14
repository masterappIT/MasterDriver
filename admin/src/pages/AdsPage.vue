<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { dateTime, fromLocalInput } from '../format';

type Position = 'CLAIM_PAGE' | 'HOME' | 'MY_ORDERS';

interface Ad {
  id: string;
  position: Position;
  title: string;
  body: string;
  imageUrl: string;
  linkUrl: string;
  priority: number;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  live: boolean;
  last30Days: { impressions: number; clicks: number };
}

const POSITION: Record<Position, string> = {
  CLAIM_PAGE: '搶單頁（內容下方）',
  HOME: '司機端首頁底部',
  MY_ORDERS: '我的接單／我的派單',
};

const ads = ref<Ad[]>([]);
const error = ref('');
const message = ref('');
const form = reactive({ position: 'CLAIM_PAGE' as Position, title: '', body: '', imageUrl: '', linkUrl: '', priority: 0, endsAt: '' });

async function run(action: () => Promise<Ad[]>, done: string) {
  error.value = '';
  message.value = '';
  try {
    ads.value = await action();
    message.value = done;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function create() {
  return run(async () => {
    const result = await api<Ad[]>('POST', '/ads', {
      position: form.position,
      title: form.title,
      body: form.body,
      imageUrl: form.imageUrl,
      linkUrl: form.linkUrl,
      priority: Number(form.priority),
      endsAt: fromLocalInput(form.endsAt) ?? null,
    });
    Object.assign(form, { title: '', body: '', imageUrl: '', endsAt: '' });
    return result;
  }, '已新增');
}

const setActive = (ad: Ad, active: boolean) => run(() => api('PATCH', `/ads/${ad.id}`, { active }), active ? '已上架' : '已下架');

function remove(ad: Ad) {
  if (!confirm(`刪除「${ad.title}」？統計數字會一併刪除。只想暫停的話請用「下架」。`)) return;
  return run(() => api('DELETE', `/ads/${ad.id}`), '已刪除');
}

const ctr = (ad: Ad) =>
  ad.last30Days.impressions === 0 ? '—' : `${((ad.last30Days.clicks / ad.last30Days.impressions) * 100).toFixed(1)}%`;

onMounted(() => run(() => api('GET', '/ads'), ''));
</script>

<template>
  <h1>廣告欄位</h1>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <div class="notice">廣告只出現在司機看到的頁面；乘客確認頁和名片頁<strong>不放廣告</strong>。每個位置最多同時顯示 3 則，依優先度排序。</div>

  <form class="card ads-page__form" @submit.prevent="create">
    <h2>新增廣告</h2>
    <div class="row">
      <select v-model="form.position" class="select">
        <option v-for="(label, key) in POSITION" :key="key" :value="key">{{ label }}</option>
      </select>
      <input v-model="form.title" class="input" maxlength="60" placeholder="標題，例如：想要自己品牌的小程序？" required />
      <input v-model.number="form.priority" class="input ads-page__number" type="number" min="0" max="1000" title="優先度" />
    </div>
    <input v-model="form.body" class="input" maxlength="200" placeholder="說明（選填）" />
    <div class="row">
      <input v-model="form.linkUrl" class="input ads-page__url" placeholder="連結 https://（例如 Master Travel 預約演示）" required />
      <input v-model="form.imageUrl" class="input ads-page__url" placeholder="圖片網址 https://（選填）" />
      <label class="field">下架時間（留空為不限）<input v-model="form.endsAt" class="input" type="datetime-local" /></label>
    </div>
    <div><button class="button" type="submit">新增</button></div>
  </form>

  <div class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>位置</th>
          <th>標題</th>
          <th class="num">優先度</th>
          <th>期間</th>
          <th class="num">近 30 天曝光／點擊</th>
          <th class="num">點擊率</th>
          <th>狀態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="ad in ads" :key="ad.id">
          <td class="nowrap">{{ POSITION[ad.position] }}</td>
          <td class="wide">
            <a :href="ad.linkUrl" target="_blank" rel="noopener noreferrer">{{ ad.title }}</a>
            <div class="hint">{{ ad.body }}</div>
          </td>
          <td class="num">{{ ad.priority }}</td>
          <td class="nowrap">{{ dateTime(ad.startsAt) }}<br />至 {{ ad.endsAt ? dateTime(ad.endsAt) : '不限' }}</td>
          <td class="num">{{ ad.last30Days.impressions }} / {{ ad.last30Days.clicks }}</td>
          <td class="num">{{ ctr(ad) }}</td>
          <td><span class="tag" :class="{ 'tag--info': ad.live }">{{ ad.live ? '顯示中' : ad.active ? '未到或已過期' : '已下架' }}</span></td>
          <td class="row">
            <button v-if="ad.active" class="button secondary" @click="setActive(ad, false)">下架</button>
            <button v-else class="button secondary" @click="setActive(ad, true)">上架</button>
            <button class="button danger" @click="remove(ad)">刪除</button>
          </td>
        </tr>
        <tr v-if="ads.length === 0">
          <td colspan="8" class="muted">還沒有廣告</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.ads-page__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.ads-page__number {
  width: 90px;
}

.ads-page__url {
  flex: 1;
  min-width: 220px;
}
</style>
