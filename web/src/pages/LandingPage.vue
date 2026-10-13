<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api';
import AppIcon from '../components/AppIcon.vue';
import BrandPanel from '../components/BrandPanel.vue';
import PlateTag from '../components/PlateTag.vue';
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

/**
 * What the tool changes, each said in one line: the first part plainly, the second part
 * (`mark`) is what to remember. Written as sentences, not as a grid of features.
 */
const LINES = [
  { text: '照樣在群裡出單、聊天、搶單，', mark: '只是多了一條連結。' },
  { text: '不用開公司、不用建車隊，', mark: '一個人就能用。' },
  {
    text: '乘客是你的客人：電話到出發前才給接單司機，',
    mark: '行程結束就收回。',
  },
  { text: '出單價給群裡看，', mark: '乘客價只有你知道。' },
  { text: '中途換車分段派，', mark: '乘客只收到一條連結。' },
];

/**
 * The story plays by itself once it is on screen, and every tap moves it on, so the page can be
 * tried, not only read: 0 the text in the group, 1 a driver opens the link, 2 the order is
 * taken, 3 the passenger's page. Without motion (or without the observer) everything shows.
 */
const LAST_SCENE = 3;
const SCENE_MS = 1900;
const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene = ref(still || !('IntersectionObserver' in window) ? LAST_SCENE : 0);
const story = ref<HTMLElement | null>(null);
const lines = ref<HTMLElement | null>(null);
const linesShown = ref(still || !('IntersectionObserver' in window));
let timer: ReturnType<typeof setTimeout> | undefined;
let watcher: IntersectionObserver | undefined;

function play() {
  clearTimeout(timer);
  if (scene.value < LAST_SCENE) timer = setTimeout(next, SCENE_MS);
}

function next() {
  if (scene.value < LAST_SCENE) scene.value += 1;
  play();
}

function replay() {
  scene.value = 0;
  play();
}

usePageSeo('HOME', {
  title: 'MasterDriver 跨境師傅幫｜有單就派，有空就接',
  description: '跨境司機在微信群和 WhatsApp 群派單、搶單、請乘客確認的免費工具。不用換群，不用下載 App。',
});

onBeforeUnmount(() => {
  clearTimeout(timer);
  watcher?.disconnect();
});

onMounted(async () => {
  void loadSite();
  if ('IntersectionObserver' in window && !still) {
    watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === story.value) play();
          else linesShown.value = true;
          watcher?.unobserve(entry.target);
        }
      },
      { threshold: 0.3 },
    );
    if (story.value) watcher.observe(story.value);
    if (lines.value) watcher.observe(lines.value);
  }
  const [terms, privacy] = await Promise.all([
    api<{ text: string }>('GET', '/public/terms').catch(() => ({ text: '' })),
    api<{ text: string }>('GET', '/public/privacy').catch(() => ({ text: '' })),
  ]);
  legal.value = {
    terms: Boolean(terms.text.trim()),
    privacy: Boolean(privacy.text.trim()),
  };
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
      <!-- The one thing to do on this page: the only button. -->
      <section class="landing__hero">
        <p class="landing__name">{{ t('跨境師傅幫') }}</p>
        <h1>{{ t('有單就派，') }}<br />{{ t('有空就接') }}</h1>
        <p class="landing__lead">
          {{ t('跨境司機在微信群和 WhatsApp 群裡派單、搶單、請乘客確認的工具。') }}
        </p>
        <RouterLink class="button block landing__start" to="/login">{{ t('開始使用') }}</RouterLink>
        <p class="landing__points">
          {{ POINTS.map((point) => t(point)).join(' · ') }}
        </p>
      </section>

      <!-- One order followed through a group. It plays by itself; tapping moves it on. -->
      <section ref="story" class="landing__story">
        <p class="landing__say">{{ t('你在群裡貼一段文字') }}</p>
        <div class="landing__bubble landing__bubble--mine">
          <strong>{{ t(SAMPLE.heading) }}</strong>
          <span v-for="line in SAMPLE.lines" :key="line">{{ t(line) }}</span>
          <span>
            {{ t('搶單：')
            }}<button class="landing__link" :class="{ 'landing__link--ask': scene === 0 }" type="button" @click="next">
              {{ SAMPLE.link }}
            </button>
          </span>
        </div>

        <div class="landing__scene" :class="{ 'landing__scene--on': scene >= 1 }">
          <div>
            <p class="landing__say">{{ t('司機點連結，先到先得') }}</p>
            <button
              class="landing__bubble landing__bubble--claim"
              :class="{ 'landing__bubble--won': scene >= 2 }"
              type="button"
              :tabindex="scene >= 1 ? 0 : -1"
              @click="next"
            >
              <span class="landing__who">{{ t('李師傅打開連結') }}</span>
              <strong>{{ scene >= 2 ? t('搶到了') : t('HK$850 · 立即搶單') }}</strong>
              <span class="landing__after">{{ scene >= 2 ? t('其他群打開同一條連結，都看到「已被接走」') : t('點一下試試') }}</span>
            </button>
          </div>
        </div>

        <div class="landing__scene" :class="{ 'landing__scene--on': scene >= 3 }">
          <div>
            <p class="landing__say">{{ t('乘客點連結，看到司機和車') }}</p>
            <div class="landing__bubble landing__bubble--passenger">
              <span class="landing__who">{{ t('10/15（四）14:30 · 深圳灣口岸 至 香港國際機場') }}</span>
              <strong>{{ t('李師傅 · 埃爾法 · 兩地牌') }}</strong>
              <PlateTag hk="AB 1234" mainland="粵Z·1234港" />
              <span class="landing__confirmed">{{ t('乘客已確認行程') }}</span>
            </div>
          </div>
        </div>
        <p class="landing__note">
          {{ t('以上是示範，不是真實的單。')
          }}<button v-if="scene === LAST_SCENE && !still" class="landing__replay" type="button" @click="replay">
            {{ t('再看一次') }}
          </button>
        </p>
      </section>

      <!-- What changes, as sentences to read down the page; they come in one after another. -->
      <section ref="lines" class="landing__lines" :class="{ 'landing__lines--on': linesShown }">
        <p v-for="(line, index) in LINES" :key="line.mark" :style="{ transitionDelay: `${index * 120}ms` }">
          {{ t(line.text) }}<strong>{{ t(line.mark) }}</strong>
        </p>
      </section>

      <section class="landing__close">
        <p class="landing__fee">{{ t('目前免費。') }}<br />{{ t('接單和乘客確認永遠免費。') }}</p>
        <RouterLink class="landing__go" to="/login">{{ t('用手機號碼登入，馬上出第一張單') }}</RouterLink>
      </section>

      <!-- For fleets and companies only: where the tool leads, said once, as a line and not a button. -->
      <a v-if="settings?.upgradeUrl" class="landing__upgrade" :href="settings.upgradeUrl" target="_blank" rel="noopener">
        <span>{{ t('車隊和公司') }}</span>
        <strong>{{ t('想要自己品牌的小程序和 App？') }}</strong>
        <span class="landing__upgrade-go">{{ t('了解 Master Travel') }}<AppIcon name="chevron" :size="18" /></span>
      </a>

      <footer class="landing__footer">
        <div class="landing__links">
          <RouterLink to="/support">{{ t('聯絡客服') }}</RouterLink>
          <RouterLink v-if="legal.terms" to="/legal/terms">{{ t('服務條款') }}</RouterLink>
          <RouterLink v-if="legal.privacy" to="/legal/privacy">{{ t('私隱政策') }}</RouterLink>
          <span v-if="settings?.support.wechatId">{{ t('微信') }}：{{ settings.support.wechatId }}</span>
          <span v-if="settings?.support.whatsapp">WhatsApp：{{ settings.support.whatsapp }}</span>
        </div>
        <p>MasterDriver {{ t('跨境師傅幫') }}・by MasterApp</p>
        <p>
          {{ t('本工具只協助司機之間派單和聯絡；車費、行程和服務由司機與乘客自行約定，平台不定價、不經手車費。') }}
        </p>
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
  gap: 56px;
  padding: var(--space-lg) var(--space-xl) 0;
}

/* The slogan is the headline; the name sits above it, small. */
.landing__hero {
  display: flex;
  flex-direction: column;
}
.landing__name {
  margin: 0 0 var(--space-sm);
  color: var(--color-teal);
  font-size: var(--font-label);
  font-weight: 700;
  letter-spacing: 0.12em;
}
.landing__hero h1 {
  margin: 0;
  font-size: 38px;
  line-height: 1.2;
  letter-spacing: 0.02em;
}
.landing__lead {
  margin: var(--space-lg) 0 var(--space-xl);
  color: var(--color-text-secondary);
  font-size: var(--font-body-large);
  line-height: 1.7;
}
/* The same pill as the sign-in button, so the two pages feel like one. */
.landing__start {
  min-height: 52px;
  border-radius: var(--radius-pill);
  font-size: 17px;
  box-shadow: 0 8px 18px rgba(31, 95, 214, 0.24);
}
.landing__points {
  margin: var(--space-md) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: center;
}

/* The story reads like a chat: a line of narration, then the message it is about. */
.landing__story {
  display: flex;
  flex-direction: column;
}
.landing__say {
  margin: 0 0 var(--space-sm);
  font-size: 18px;
  font-weight: 700;
}
.landing__bubble {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  max-width: 86%;
  margin-bottom: 36px;
  padding: var(--space-md) var(--space-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  font-size: var(--font-label);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
/* Yours, on the right, as in the group. */
.landing__bubble--mine {
  align-self: flex-end;
  border-radius: 18px 4px 18px 18px;
  background: var(--color-tint);
}
/* A scene takes no room until the story reaches it, then opens and fades in. */
.landing__scene {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  transition:
    grid-template-rows 0.5s ease,
    opacity 0.5s ease;
}
.landing__scene > div {
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Room for the bubble's shadow, which the clipping would cut. */
  margin: 0 -24px;
  padding: 0 24px;
  overflow: hidden;
}
.landing__scene--on {
  grid-template-rows: 1fr;
  opacity: 1;
  pointer-events: auto;
}
.landing__bubble--claim,
.landing__bubble--passenger {
  border-radius: 4px 18px 18px 18px;
}
/* The driver's side: a thing to press. Gold while it is open, then it settles. */
.landing__bubble--claim {
  border: 2px solid var(--color-gold);
  font: inherit;
  font-size: var(--font-label);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.3s ease,
    transform 0.15s ease;
}
.landing__bubble--claim:active {
  transform: scale(0.97);
}
.landing__bubble--claim strong {
  color: var(--color-gold-ink);
  font-size: 20px;
}
.landing__bubble--won {
  border-color: transparent;
  cursor: default;
}
.landing__bubble--won strong {
  color: var(--status-confirmed);
}
.landing__bubble--passenger {
  gap: var(--space-xs);
  margin-bottom: var(--space-lg);
}
.landing__bubble--passenger strong {
  font-size: var(--font-body-large);
}
.landing__who,
.landing__after {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.landing__link {
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
/* Before anything has happened, the link asks to be pressed. */
.landing__link--ask {
  animation: landing-ask 1.4s ease-in-out infinite;
}
@keyframes landing-ask {
  50% {
    background: rgba(31, 95, 214, 0.16);
    box-shadow: 0 0 0 4px rgba(31, 95, 214, 0.16);
  }
}
.landing__replay {
  margin-left: var(--space-sm);
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.landing__confirmed {
  margin-top: var(--space-xs);
  color: var(--status-confirmed);
  font-weight: 700;
}
.landing__note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}

/* Sentences, large, one under another: the last words of each are what to remember. */
.landing__lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}
.landing__lines p {
  margin: 0;
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity 0.5s ease,
    transform 0.5s ease;
  color: var(--color-text-secondary);
  font-size: 19px;
  line-height: 1.6;
  text-wrap: pretty;
}
.landing__lines--on p {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .landing__scene,
  .landing__lines p {
    transition: none;
  }
  .landing__link--ask {
    animation: none;
  }
}
.landing__lines strong {
  color: var(--color-text);
}

.landing__close {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.landing__fee {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.35;
}
.landing__go {
  align-self: flex-start;
  font-size: var(--font-body-large);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 4px;
}

.landing__footer {
  color: var(--color-text-muted);
  font-size: var(--font-caption);
}
.landing__upgrade {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-top: var(--space-xl);
  border-top: 1px solid var(--color-divider);
  color: var(--color-text);
}
.landing__upgrade > span:first-child {
  color: var(--color-teal);
  font-size: var(--font-label);
  font-weight: 700;
  letter-spacing: 0.12em;
}
.landing__upgrade strong {
  font-size: 19px;
  line-height: 1.5;
}
.landing__upgrade-go {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--color-primary);
  font-weight: 700;
}
.landing__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm) var(--space-lg);
}
.landing__footer p {
  margin: var(--space-sm) 0 0;
}
</style>
