<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { notify } from '../feedback';

/**
 * 教學連結: the public 使用教學 pages (/guide on the driver site), for staff to open and to copy
 * into a group, a 客服 reply or a sales chat. The words of the guides are in the code
 * (web/src/guides/content.ts), not edited here. A Simplified link opens the guide in 简体 for that
 * visit, for mainland drivers.
 */
interface GuideLink {
  slug: string | null;
  title: string;
  description: string;
  url: string;
}

const guides = ref<GuideLink[] | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    guides.value = (await api<{ items: GuideLink[] }>('GET', '/guides')).items;
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const simplified = (url: string) => `${url}?lang=zh-Hans`;

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify(done);
  } catch {
    notify('複製失敗，請直接選取連結複製', true);
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-head__title">
        <h1>教學連結</h1>
        <span v-if="guides" class="muted">共 {{ guides.length }} 個</span>
      </div>
      <p class="page-head__desc">
        給司機看的使用教學，不用登入就能打開：每篇先講這個功能幫司機做什麼生意，再講怎樣用。複製連結貼到司機群、客服回覆或傳給新司機；內地司機用簡體連結，打開就是简体。
      </p>
    </div>
  </div>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>教學</th>
          <th>連結</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="guide in guides ?? []" :key="guide.url">
          <td>
            <strong>{{ guide.title }}</strong>
            <div class="hint">{{ guide.description }}</div>
          </td>
          <td class="guide-links__url">
            <a :href="guide.url" target="_blank" rel="noopener">{{ guide.url }}</a>
          </td>
          <td class="nowrap guide-links__actions">
            <button class="button" type="button" @click="copy(guide.url, `${guide.title}連結已複製`)">複製連結</button>
            <button class="button secondary" type="button" @click="copy(simplified(guide.url), `${guide.title}簡體連結已複製`)">複製簡體連結</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.guide-links__url {
  overflow-wrap: anywhere;
}
.guide-links__actions {
  display: flex;
  gap: 8px;
}
</style>
