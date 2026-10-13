<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import BrandMark from '../components/BrandMark.vue';
import { language, setLanguage, t } from '../i18n';
import { usePageSeo } from '../seo';
import { loadSite, site } from '../site';

/** The platform's public home page: what the tool is, for someone who is not signed in. */
const settings = computed(() => site.settings);
const legal = ref({ terms: false, privacy: false });

const STEPS = [
  { title: '發單，拿到一條連結', text: '照平常在群裡的寫法輸入一句話，時間、路線、座位、價格自動填好。' },
  { title: '貼到微信群或 WhatsApp 群', text: '同一條連結可以貼到好幾個群，不用換群，也不用叫大家下載 App。' },
  { title: '司機點連結搶單', text: '先到先得。有人接走後，每個群打開連結都會看到「已被接走」。' },
  { title: '乘客點連結確認', text: '乘客不用登入，打開就看到司機和車牌，按一下確認行程。' },
];

const REASONS = [
  { title: '不改變習慣', text: '照樣在群裡發單、聊天、搶單，只是多了一條連結。' },
  { title: '一個人也能用', text: '不用先開公司、不用建車隊，用手機號碼登入就能發單和接單。' },
  { title: '乘客電話到時間才顯示', text: '接單司機在出發前才看得到乘客電話，之前只能聯絡你。' },
  { title: '兩個價格分開', text: '司機價給群裡看，乘客價只有你和乘客知道，差價只有你看得到。' },
  { title: '接駁也是一張行程', text: '中途換車時每段各自派單，乘客只收到一條連結，一次確認全部。' },
  { title: '有客服', text: '用的時候有問題，直接在頁面上傳文字、圖片或影片給我們。' },
];

usePageSeo('HOME', {
  title: 'MasterDriver 跨境師傅幫｜有單就派，有空就接',
  description: '跨境司機在微信群和 WhatsApp 群派單、搶單、請乘客確認的免費工具。不用換群，不用下載 App。',
});

onMounted(async () => {
  void loadSite();
  const [terms, privacy] = await Promise.all([
    api<{ text: string }>('GET', '/public/terms').catch(() => ({ text: '' })),
    api<{ text: string }>('GET', '/public/privacy').catch(() => ({ text: '' })),
  ]);
  legal.value = { terms: Boolean(terms.text.trim()), privacy: Boolean(privacy.text.trim()) };
});
</script>

<template>
  <div class="landing">
    <header class="landing__top">
      <BrandMark />
      <div class="row">
        <button class="chip" :class="{ 'landing__chip--on': language === 'zh-Hant' }" type="button" @click="setLanguage('zh-Hant')">繁體</button>
        <button class="chip" :class="{ 'landing__chip--on': language === 'zh-Hans' }" type="button" @click="setLanguage('zh-Hans')">简体</button>
      </div>
    </header>

    <section class="landing__hero">
      <h1>{{ t('跨境師傅幫') }}</h1>
      <p class="landing__slogan">{{ t('有單就派，有空就接') }}</p>
      <p class="landing__lead">{{ t('跨境司機在微信群和 WhatsApp 群裡派單、搶單、請乘客確認的工具。不用換群，不用下載 App。') }}</p>
      <RouterLink class="button block large" to="/login">{{ t('開始使用') }}</RouterLink>
      <p class="hint landing__free">{{ t('用手機號碼登入，目前免費。') }}</p>
    </section>

    <section class="landing__section">
      <h2>{{ t('怎麼用') }}</h2>
      <ol class="landing__steps">
        <li v-for="(step, index) in STEPS" :key="step.title" class="card landing__step">
          <span class="landing__number">{{ index + 1 }}</span>
          <div>
            <strong>{{ t(step.title) }}</strong>
            <p class="muted">{{ t(step.text) }}</p>
          </div>
        </li>
      </ol>
    </section>

    <section class="landing__section">
      <h2>{{ t('為什麼用它') }}</h2>
      <div v-for="reason in REASONS" :key="reason.title" class="landing__reason">
        <strong>{{ t(reason.title) }}</strong>
        <p class="muted">{{ t(reason.text) }}</p>
      </div>
    </section>

    <section class="landing__section card">
      <h2>{{ t('費用') }}</h2>
      <p>{{ t('目前免費。接單和乘客確認永遠免費。') }}</p>
    </section>

    <a v-if="settings?.upgradeUrl" class="landing__section card landing__upgrade" :href="settings.upgradeUrl" target="_blank" rel="noopener">
      <strong>{{ t('車隊和公司：想要自己品牌的小程序和 App？') }}</strong>
      <span class="muted">{{ t('了解 Master Travel：報價、收款、結算、司機管理一站搞定 →') }}</span>
    </a>

    <section class="landing__section landing__cta">
      <RouterLink class="button block large" to="/login">{{ t('開始使用') }}</RouterLink>
      <RouterLink class="button secondary block" to="/support">{{ t('有問題？聯絡客服') }}</RouterLink>
    </section>

    <footer class="landing__footer hint">
      <div class="row landing__links">
        <RouterLink v-if="legal.terms" to="/legal/terms">{{ t('服務條款') }}</RouterLink>
        <RouterLink v-if="legal.privacy" to="/legal/privacy">{{ t('私隱政策') }}</RouterLink>
        <span v-if="settings?.support.wechatId">{{ t('微信') }}：{{ settings.support.wechatId }}</span>
        <span v-if="settings?.support.whatsapp">WhatsApp：{{ settings.support.whatsapp }}</span>
      </div>
      <p>MasterDriver {{ t('跨境師傅幫') }}・by MasterApp</p>
      <p>{{ t('本工具只協助司機之間派單和聯絡；車費、行程和服務由司機與乘客自行約定，平台不定價、不收款。') }}</p>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  padding: var(--space-lg);
  padding-bottom: calc(var(--space-xl) + var(--safe-bottom));
}
.landing__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.landing__chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.landing__hero {
  padding: var(--space-xl) 0;
}
.landing__hero h1 {
  font-size: 34px;
  line-height: 1.2;
  margin: var(--space-lg) 0 var(--space-xs);
}
.landing__slogan {
  margin: 0 0 var(--space-md);
  font-size: 20px;
  font-weight: 600;
  color: var(--color-primary-dark);
}
.landing__lead {
  margin: 0 0 var(--space-xl);
  font-size: var(--font-body-large);
  color: var(--color-text-secondary);
}
.landing__free {
  text-align: center;
  margin: var(--space-sm) 0 0;
}
.landing__section {
  margin-top: var(--space-xl);
}
.landing__steps {
  list-style: none;
  margin: 0;
  padding: 0;
}
.landing__step {
  display: flex;
  gap: var(--space-md);
  align-items: flex-start;
  margin-bottom: var(--space-md);
}
.landing__step p,
.landing__reason p {
  margin: var(--space-xs) 0 0;
}
.landing__number {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.landing__reason {
  padding: var(--space-md) 0;
  border-bottom: 1px solid var(--color-divider);
}
.landing__upgrade {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--color-text);
}
.landing__cta {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.landing__footer {
  margin-top: var(--space-xl);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--color-divider);
}
.landing__links {
  gap: var(--space-md);
}
</style>
