<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import BrandPanel from '../components/BrandPanel.vue';
import RoutePoints from '../components/RoutePoints.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { language, setLanguage, t } from '../i18n';
import { usePageSeo } from '../seo';
import { loadSite, site } from '../site';

/** The platform's public home page: what the tool is, for someone who is not signed in. */
const settings = computed(() => site.settings);
const legal = ref({ terms: false, privacy: false });

/** The three points also shown on the sign-in page, so the two pages say the same thing. */
const POINTS = ['不用換群', '不用下載', '免費出單接單'];

/** A made-up order, shown the way the group text and the claim page really look. */
const SAMPLE = {
  heading: '【有單】10/15（四）14:30',
  lines: ['深圳灣口岸 → 香港國際機場', '4人｜3件行李｜7座', 'HK$850'],
  link: `${window.location.host}/o/a1b2c3`,
};

const STEPS = [
  { title: '出單，拿到一條連結', text: '照平常在群裡的寫法輸入一句話，時間、路線、座位、價格自動填好。' },
  { title: '貼到微信群或 WhatsApp 群', text: '同一條連結可以貼到好幾個群，不用換群，也不用叫大家下載 App。' },
  { title: '司機點連結搶單', text: '先到先得。有人接走後，每個群打開連結都會看到「已被接走」。' },
  { title: '乘客點連結確認', text: '乘客不用登入，打開就看到司機和車牌，按一下確認行程。' },
];

const REASONS = [
  { title: '不改變習慣', text: '照樣在群裡出單、聊天、搶單，只是多了一條連結。' },
  { title: '一個人也能用', text: '不用先開公司、不用建車隊，用手機號碼登入就能出單和接單。' },
  { title: '乘客電話到時間才顯示', text: '接單司機在出發前才看得到乘客電話，之前只能聯絡你。' },
  { title: '兩個價格分開', text: '出單價給群裡看，乘客價只有你和乘客知道，差價只有你看得到。' },
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
    <BrandPanel>
      <template #right>
        <div class="landing__lang">
          <button type="button" :class="{ on: language === 'zh-Hant' }" @click="setLanguage('zh-Hant')">繁體</button>
          <button type="button" :class="{ on: language === 'zh-Hans' }" @click="setLanguage('zh-Hans')">简体</button>
        </div>
      </template>
    </BrandPanel>

    <main class="landing__body">
      <section class="landing__hero">
        <h1>{{ t('跨境師傅幫') }}</h1>
        <p class="landing__slogan">{{ t('有單就派，有空就接') }}</p>
        <p class="landing__points">{{ POINTS.map((point) => t(point)).join(' · ') }}</p>
        <p class="landing__lead">{{ t('跨境司機在微信群和 WhatsApp 群裡派單、搶單、請乘客確認的工具。不用換群，不用下載 App。') }}</p>
        <RouterLink class="button block landing__start" to="/login">{{ t('開始使用') }}</RouterLink>
        <p class="landing__free">{{ t('用手機號碼登入，目前免費。') }}</p>
      </section>

      <section class="landing__section">
        <h2>{{ t('實際長這樣') }}</h2>
        <p class="landing__say">{{ t('出單後拿到這段文字，貼到群裡：') }}</p>
        <!-- The group text as a chat message, the way it appears in WeChat or WhatsApp. -->
        <div class="landing__bubble">
          <strong>{{ t(SAMPLE.heading) }}</strong>
          <span v-for="line in SAMPLE.lines" :key="line">{{ t(line) }}</span>
          <span>{{ t('搶單：') }}<span class="landing__link">{{ SAMPLE.link }}</span></span>
        </div>
        <p class="landing__say">{{ t('司機點開連結，看到的是：') }}</p>
        <div class="card landing__sample" aria-hidden="true">
          <div class="landing__sample-top">
            <StatusBadge status="OPEN" />
            <span class="landing__sample-price">HK$850</span>
          </div>
          <div class="landing__sample-time">10/15（四）14:30</div>
          <RoutePoints :origin="'深圳灣口岸'" :destination="'香港國際機場'" />
          <div class="landing__sample-load">{{ t('4人｜3件行李｜7座') }}</div>
          <span class="button block landing__start">{{ t('立即搶單') }}</span>
        </div>
        <p class="landing__note">{{ t('以上是示範，不是真實的單。') }}</p>
      </section>

      <section class="landing__section">
        <h2>{{ t('怎麼用') }}</h2>
        <!-- A real sequence, so a line of numbered stops. -->
        <ol class="landing__steps">
          <li v-for="(step, index) in STEPS" :key="step.title">
            <span class="landing__number">{{ index + 1 }}</span>
            <div>
              <strong>{{ t(step.title) }}</strong>
              <p>{{ t(step.text) }}</p>
            </div>
          </li>
        </ol>
      </section>

      <section class="landing__section">
        <h2>{{ t('為什麼用它') }}</h2>
        <div class="landing__reasons">
          <div v-for="reason in REASONS" :key="reason.title" class="landing__reason">
            <strong>{{ t(reason.title) }}</strong>
            <p>{{ t(reason.text) }}</p>
          </div>
        </div>
      </section>

      <section class="landing__section landing__fee">
        <h2>{{ t('費用') }}</h2>
        <p>{{ t('目前免費。接單和乘客確認永遠免費。') }}</p>
      </section>

      <a v-if="settings?.upgradeUrl" class="landing__upgrade" :href="settings.upgradeUrl" target="_blank" rel="noopener">
        <strong>{{ t('車隊和公司：想要自己品牌的小程序和 App？') }}</strong>
        <span>{{ t('了解 Master Travel：報價、收款、結算、司機管理一站搞定') }}</span>
      </a>

      <section class="landing__cta">
        <RouterLink class="button block landing__start" to="/login">{{ t('開始使用') }}</RouterLink>
        <RouterLink class="landing__support" to="/support">{{ t('有問題？聯絡客服') }}</RouterLink>
      </section>

      <footer class="landing__footer">
        <div class="landing__links">
          <RouterLink v-if="legal.terms" to="/legal/terms">{{ t('服務條款') }}</RouterLink>
          <RouterLink v-if="legal.privacy" to="/legal/privacy">{{ t('私隱政策') }}</RouterLink>
          <span v-if="settings?.support.wechatId">{{ t('微信') }}：{{ settings.support.wechatId }}</span>
          <span v-if="settings?.support.whatsapp">WhatsApp：{{ settings.support.whatsapp }}</span>
        </div>
        <p>MasterDriver {{ t('跨境師傅幫') }}・by MasterApp</p>
        <p>{{ t('本工具只協助司機之間派單和聯絡；車費、行程和服務由司機與乘客自行約定，平台不定價、不收款。') }}</p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.landing {
  padding-bottom: calc(var(--space-xl) + var(--safe-bottom));
}
.landing__lang {
  display: flex;
  margin-left: auto;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.18);
}
.landing__lang button {
  padding: 4px 12px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--color-on-primary);
  font: inherit;
  font-size: var(--font-caption);
  font-weight: 600;
  cursor: pointer;
}
.landing__lang button.on {
  background: var(--color-surface);
  color: var(--color-primary-dark);
}
.landing__body {
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: var(--space-lg) var(--space-xl) 0;
}
.landing__hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.landing__hero h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 0.02em;
}
.landing__slogan {
  margin: -6px 0 0;
  color: var(--color-text-secondary);
}
.landing__points {
  margin: -8px 0 0;
  color: var(--color-teal);
  font-size: var(--font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.landing__lead {
  margin: var(--space-sm) 0;
  line-height: 1.7;
}
/* The same pill as the sign-in button, so the two pages feel like one. */
.landing__start {
  min-height: 48px;
  border-radius: var(--radius-pill);
  font-size: 16px;
  box-shadow: 0 8px 18px rgba(31, 95, 214, 0.24);
}
.landing__free,
.landing__note {
  margin: calc(var(--space-sm) * -1) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  text-align: center;
}
.landing__section h2 {
  margin: 0 0 var(--space-md);
  font-size: 18px;
}
.landing__say {
  margin: 0 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.landing__bubble {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 88%;
  margin-bottom: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  border-radius: 4px 18px 18px 18px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  font-size: var(--font-label);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.landing__link {
  color: var(--color-primary);
}
.landing__sample {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.landing__sample-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.landing__sample-price {
  color: var(--color-gold-ink);
  font-size: 20px;
  font-weight: 700;
}
.landing__sample-time {
  font-size: 22px;
  font-weight: 700;
}
.landing__sample-load {
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-divider);
  color: var(--color-label);
  font-weight: 600;
}
.landing__steps {
  list-style: none;
  margin: 0;
  padding: 0;
}
.landing__steps li {
  position: relative;
  display: flex;
  gap: var(--space-md);
  padding-bottom: var(--space-lg);
}
/* The line joining one stop to the next. */
.landing__steps li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 13px;
  top: 30px;
  bottom: 4px;
  border-left: 2px dotted var(--color-border);
}
.landing__number {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-teal);
  color: var(--color-on-primary);
  font-size: var(--font-label);
  font-weight: 700;
}
.landing__steps strong,
.landing__reason strong {
  display: block;
  margin-bottom: 2px;
}
.landing__steps p,
.landing__reason p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
  line-height: 1.6;
}
.landing__reasons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-lg) var(--space-lg);
}
.landing__reason {
  padding-left: var(--space-md);
  border-left: 3px solid var(--color-gold);
  border-radius: 0;
}
.landing__fee p {
  margin: 0;
  font-size: var(--font-body-large);
  font-weight: 600;
}
.landing__upgrade {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-card);
  background: var(--color-tint);
  color: var(--color-text);
}
.landing__upgrade span {
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.landing__cta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
}
.landing__cta .landing__start {
  width: 100%;
}
.landing__support {
  font-size: var(--font-label);
}
.landing__footer {
  color: var(--color-text-muted);
  font-size: var(--font-caption);
  text-align: center;
}
.landing__links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-sm) var(--space-lg);
}
.landing__footer p {
  margin: var(--space-sm) 0 0;
}
</style>
