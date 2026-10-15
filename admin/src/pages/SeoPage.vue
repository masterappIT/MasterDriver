<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';

interface SiteSeo {
  canonicalOrigin: string;
  googleVerification: string;
  bingVerification: string;
  baiduVerification: string;
  baiduTongjiId: string;
  allowIndexing: boolean;
  sitemapEnabled: boolean;
}
interface PageSeo {
  title: string;
  description: string;
  keywords: string;
  shareImageUrl: string;
}
interface Seo {
  site: SiteSeo;
  pages: Record<'HOME' | 'PROFILE', PageSeo>;
}

const PAGE_LABEL = { HOME: '官網首頁', PROFILE: '司機名片頁（範本，第二階段上線）' } as const;

const site = reactive<SiteSeo>({
  canonicalOrigin: '',
  googleVerification: '',
  bingVerification: '',
  baiduVerification: '',
  baiduTongjiId: '',
  allowIndexing: false,
  sitemapEnabled: false,
});
const pages = reactive<Record<'HOME' | 'PROFILE', PageSeo>>({
  HOME: { title: '', description: '', keywords: '', shareImageUrl: '' },
  PROFILE: { title: '', description: '', keywords: '', shareImageUrl: '' },
});
const error = ref('');
const message = ref('');

function fill(seo: Seo) {
  Object.assign(site, seo.site);
  for (const key of ['HOME', 'PROFILE'] as const) {
    const { title, description, keywords, shareImageUrl } = seo.pages[key];
    Object.assign(pages[key], { title, description, keywords, shareImageUrl });
  }
}

async function run(action: () => Promise<Seo>, done: string) {
  error.value = '';
  message.value = '';
  try {
    fill(await action());
    message.value = done;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function saveSite() {
  if (site.allowIndexing && !site.canonicalOrigin) {
    error.value = '開放收錄前，請先填寫正式網域';
    return;
  }
  const { canonicalOrigin, googleVerification, bingVerification, baiduVerification, baiduTongjiId, allowIndexing, sitemapEnabled } =
    site;
  return run(
    () =>
      api('PUT', '/seo/site', {
        canonicalOrigin,
        googleVerification,
        bingVerification,
        baiduVerification,
        baiduTongjiId,
        allowIndexing,
        sitemapEnabled,
      }),
    '網站設定已儲存',
  );
}

const savePage = (key: 'HOME' | 'PROFILE') => run(() => api('PUT', `/seo/pages/${key}`, { ...pages[key] }), `「${PAGE_LABEL[key]}」已儲存`);

onMounted(() => run(() => api('GET', '/seo'), ''));
</script>

<template>
  <div class="settings-page">
    <h1>SEO</h1>
    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice">{{ message }}</div>
    <div class="notice">搶單頁、乘客確認頁、司機端、後台和 API 含行程或帳號資料，<strong>一律不讓搜尋引擎收錄</strong>，這裡的設定改變不了這一點。</div>

    <form class="card seo-page__card" @submit.prevent="saveSite">
      <h2>網站設定</h2>
      <label class="row"><input v-model="site.allowIndexing" type="checkbox" /> 開放搜尋引擎收錄（上線並確認網域後才開啟）</label>
      <label class="row"><input v-model="site.sitemapEnabled" type="checkbox" /> 提供 sitemap</label>
      <label class="field">正式網域<input v-model="site.canonicalOrigin" class="input" placeholder="https://example.com（結尾不要加 /）" /></label>
      <div class="form-grid">
        <label class="field">Google 驗證碼<input v-model="site.googleVerification" class="input" /></label>
        <label class="field">Bing 驗證碼<input v-model="site.bingVerification" class="input" /></label>
        <label class="field">百度驗證碼<input v-model="site.baiduVerification" class="input" /></label>
        <label class="field">百度統計 ID<input v-model="site.baiduTongjiId" class="input" /></label>
      </div>
      <p class="hint">只填驗證碼或 ID 本身，不要貼整段程式碼。Google Analytics 在內地無法使用，統計改用百度統計。</p>
      <div class="form-foot"><button class="button" type="submit">儲存網站設定</button></div>
    </form>

    <!-- The two pages side by side: the same four fields each. -->
    <div class="split seo-page__pages">
    <form v-for="key in (['HOME', 'PROFILE'] as const)" :key="key" class="card seo-page__card" @submit.prevent="savePage(key)">
      <h2>{{ PAGE_LABEL[key] }}</h2>
      <p v-if="key === 'PROFILE'" class="hint">可用變數：{司機} {路線} {車型} {地區}。例如「{司機}｜{路線}｜跨境師傅幫」，缺少的值會連同分隔符號一起省略。</p>
      <label class="field">標題<input v-model="pages[key].title" class="input" maxlength="120" /></label>
      <label class="field">描述<textarea v-model="pages[key].description" class="input" maxlength="300" /></label>
      <label class="field">關鍵字（以逗號分隔）<input v-model="pages[key].keywords" class="input" maxlength="200" placeholder="跨境包車, 中港車, 深圳灣接送" /></label>
      <label class="field">分享圖網址<input v-model="pages[key].shareImageUrl" class="input" placeholder="https://" /></label>
      <div class="form-foot"><button class="button" type="submit">儲存</button></div>
    </form>
    </div>
  </div>
</template>

<style scoped>
.seo-page__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* Side by side, the cards are as tall as each other and their save rows line up at the bottom. */
.seo-page__pages {
  align-items: stretch;
}

.seo-page__card > h2,
.seo-page__card > p {
  margin: 0;
}

/* The card's gap already gives 12px; the save row's line sits 20px below the fields like elsewhere. */
.seo-page__card > .form-foot {
  margin-top: 8px;
}
.seo-page__pages .seo-page__card > .form-foot {
  margin-top: auto;
}
</style>
