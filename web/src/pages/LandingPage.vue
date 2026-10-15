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
 * What the tool does that a group alone cannot, each as something to try rather than read:
 * a tab picks the point, and the picture under it answers to taps.
 */
type Point = 'link' | 'booking' | 'phone' | 'price' | 'data' | 'transfer';
const POINT_TABS: { value: Point; label: string }[] = [
  { value: 'link', label: '一條連結' },
  { value: 'booking', label: '客人詢價' },
  { value: 'phone', label: '客人電話' },
  { value: 'price', label: '兩個價錢' },
  { value: 'data', label: '資料安全' },
  { value: 'transfer', label: '接駁' },
];
const point = ref<Point>('link');

/** 一條連結: the same link in every group; once one driver has it, every group shows it taken. */
const GROUPS = ['微信群 A', '微信群 B', 'WhatsApp 群'];
const linkTaken = ref(false);

/**
 * 客人詢價: the driver's own 名片頁 takes bookings from their own customers. The driver quotes,
 * the passenger agrees, and one tap makes it the driver's trip.
 */
const BOOKING_STEPS = [
  { label: '客人詢價', note: '乘客在你的名片頁填', shows: '10/15 深圳灣 至 機場' },
  { label: '你報價', note: '你回一個價錢', shows: 'HK$1,000' },
  { label: '成單', note: '乘客同意，你按一下', shows: '成為你的行程' },
];
const bookingStep = ref(0);

/** 客人電話: what the driver who took the order sees of the passenger's phone, by moment. */
const MOMENTS = [
  { label: '剛搶到', shows: '到時間才顯示', open: false },
  { label: '出發前', shows: '+852 9123 4567', open: true },
  { label: '行程結束', shows: '已收回', open: false },
];
const moment = ref(0);

/** 兩個價錢: who sees which. */
const VIEWERS = [
  { label: '群裡', amount: 'HK$850', note: '出單價' },
  { label: '乘客', amount: 'HK$1,000', note: '乘客價' },
  { label: '只有你', amount: 'HK$150', note: '差價' },
];
const viewer = ref(0);

/**
 * 資料安全: who sees the passengers of the orders you put out. Only what the tool really does:
 * the 客人通訊錄 is the dispatcher's alone, and a driver gets one order's passenger for one trip.
 */
const KEEPERS = [
  { label: '你', sees: '全部客人', note: '客人通訊錄只有你打得開' },
  { label: '接單司機', sees: '只有這一單的乘客', note: '到時間才顯示，行程結束就收回' },
  { label: '其他司機', sees: '看不到', note: '沒搶到的人看不到乘客資料' },
];
const keeper = ref(0);

/** 接駁: two legs for you, one link for the passenger. */
const passengerSide = ref(false);

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
const points = ref<HTMLElement | null>(null);
const pointsShown = ref(still || !('IntersectionObserver' in window));
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
          else pointsShown.value = true;
          watcher?.unobserve(entry.target);
        }
      },
      { threshold: 0.3 },
    );
    if (story.value) watcher.observe(story.value);
    if (points.value) watcher.observe(points.value);
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
        <!-- The brand mark above already names us; this line says who it is for. -->
        <p class="landing__name">{{ t('跨境司機的派單工具') }}</p>
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

      <!-- What a group alone cannot do: pick a point, then try it. -->
      <section ref="points" class="landing__points-play" :class="{ 'landing__points-play--on': pointsShown }">
        <div class="landing__tabs" role="tablist">
          <button v-for="tab in POINT_TABS" :key="tab.value" type="button" role="tab" :aria-selected="point === tab.value" @click="point = tab.value">
            {{ t(tab.label) }}
          </button>
        </div>

        <!-- 一條連結 -->
        <div v-if="point === 'link'" class="landing__stage">
          <p class="landing__claim">{{ t('貼到幾個群都是同一條') }}</p>
          <div class="landing__groups">
            <span v-for="group in GROUPS" :key="group" class="landing__group" :class="{ 'landing__group--taken': linkTaken }">
              <small>{{ t(group) }}</small>{{ linkTaken ? t('已被接走') : t('有單') }}
            </span>
          </div>
          <button class="landing__try" type="button" @click="linkTaken = !linkTaken">{{ linkTaken ? t('再來一次') : t('一位司機搶到') }}</button>
        </div>

        <!-- 客人詢價 -->
        <div v-else-if="point === 'booking'" class="landing__stage">
          <p class="landing__claim">{{ t('你的名片頁，客人直接向你詢價、約車') }}</p>
          <div class="landing__reveal landing__reveal--open">
            <small>{{ t(BOOKING_STEPS[bookingStep].note) }}</small>
            <strong :class="{ 'landing__done': bookingStep === 2 }">{{ t(BOOKING_STEPS[bookingStep].shows) }}</strong>
          </div>
          <div class="segment segment--block">
            <button v-for="(item, index) in BOOKING_STEPS" :key="item.label" type="button" :aria-pressed="bookingStep === index" @click="bookingStep = index">{{ t(item.label) }}</button>
          </div>
          <p class="landing__promise">{{ t('名片頁放到朋友圈、小紅書或傳給熟客。價錢由你報，客人是你的。') }}</p>
        </div>

        <!-- 客人電話 -->
        <div v-else-if="point === 'phone'" class="landing__stage">
          <p class="landing__claim">{{ t('乘客是你的客人') }}</p>
          <div class="landing__reveal" :class="{ 'landing__reveal--open': MOMENTS[moment].open }">
            <small>{{ t('接單司機看到的乘客電話') }}</small>
            <strong>{{ t(MOMENTS[moment].shows) }}</strong>
          </div>
          <div class="segment segment--block">
            <button v-for="(item, index) in MOMENTS" :key="item.label" type="button" :aria-pressed="moment === index" @click="moment = index">{{ t(item.label) }}</button>
          </div>
        </div>

        <!-- 兩個價錢 -->
        <div v-else-if="point === 'price'" class="landing__stage">
          <p class="landing__claim">{{ t('賺多少，只有你知道') }}</p>
          <div class="landing__amount">
            <small>{{ t(VIEWERS[viewer].note) }}</small>
            <strong>{{ VIEWERS[viewer].amount }}</strong>
          </div>
          <div class="segment segment--block">
            <button v-for="(item, index) in VIEWERS" :key="item.label" type="button" :aria-pressed="viewer === index" @click="viewer = index">{{ t(item.label) }}</button>
          </div>
        </div>

        <!-- 資料安全 -->
        <div v-else-if="point === 'data'" class="landing__stage">
          <p class="landing__claim">{{ t('客人資料，你自己管') }}</p>
          <div class="landing__reveal" :class="{ 'landing__reveal--open': keeper === 0 }">
            <small>{{ t(KEEPERS[keeper].note) }}</small>
            <strong>{{ t(KEEPERS[keeper].sees) }}</strong>
          </div>
          <div class="segment segment--block">
            <button v-for="(item, index) in KEEPERS" :key="item.label" type="button" :aria-pressed="keeper === index" @click="keeper = index">{{ t(item.label) }}</button>
          </div>
          <p class="landing__promise">{{ t('電話幾時給司機、車牌給不給乘客看，都由你決定。平台不把你的客人派給別人。') }}</p>
        </div>

        <!-- 接駁 -->
        <div v-else class="landing__stage">
          <p class="landing__claim">{{ t('中途換車，分段派') }}</p>
          <div v-if="!passengerSide" class="landing__legs">
            <span class="landing__leg"><small>{{ t('第 1 段') }}</small>{{ t('深圳 至 口岸') }}<em>{{ t('李師傅') }}</em></span>
            <span class="landing__leg"><small>{{ t('第 2 段') }}</small>{{ t('口岸 至 機場') }}<em>{{ t('何師傅') }}</em></span>
          </div>
          <div v-else class="landing__legs landing__legs--one">
            <span class="landing__leg"><small>{{ t('一條連結') }}</small>{{ t('深圳 至 機場，兩位司機') }}<em>{{ t('確認一次') }}</em></span>
          </div>
          <div class="segment segment--block">
            <button type="button" :aria-pressed="!passengerSide" @click="passengerSide = false">{{ t('你派的') }}</button>
            <button type="button" :aria-pressed="passengerSide" @click="passengerSide = true">{{ t('乘客看到的') }}</button>
          </div>
        </div>
      </section>

      <section class="landing__close">
        <p class="landing__fee">{{ t('免費。一個人就能用。') }}</p>
        <RouterLink class="landing__go" to="/login">{{ t('用手機號碼登入') }}</RouterLink>
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
        <p class="landing__copyright">© 2026 IM MASTER INC. LIMITED All Rights Reserved.</p>
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
  font-size: 19px;
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
  font-size: 20px;
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
  font-size: 22px;
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

/* The points: tabs to pick one, and a stage that answers to taps. It rises in when reached. */
.landing__points-play {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 0.5s ease,
    transform 0.5s ease;
}
.landing__points-play--on {
  opacity: 1;
  transform: none;
}
.landing__tabs {
  display: flex;
  gap: var(--space-sm);
  margin: 0 calc(var(--space-xl) * -1);
  padding: 0 var(--space-xl);
  overflow-x: auto;
  scrollbar-width: none;
}
.landing__tabs::-webkit-scrollbar {
  display: none;
}
.landing__tabs button {
  flex-shrink: 0;
  min-height: 38px;
  padding: 0 var(--space-lg);
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}
.landing__tabs button[aria-selected='true'] {
  background: var(--color-text);
  color: var(--color-on-primary);
}
.landing__stage {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  /* About the height of most stages, so the page below hardly moves between tabs. */
  min-height: 216px;
  animation: landing-stage 0.35s ease;
}
@keyframes landing-stage {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.landing__claim {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.3;
}
.landing__stage small {
  display: block;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 600;
}
/* 一條連結: the groups, side by side, all changing at once. */
.landing__groups {
  display: flex;
  gap: var(--space-sm);
}
.landing__group {
  flex: 1;
  min-width: 0;
  padding: var(--space-md);
  border-radius: 16px;
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  font-weight: 700;
  transition:
    background 0.3s ease,
    color 0.3s ease;
}
.landing__group--taken {
  background: var(--color-divider);
  color: var(--color-text-secondary);
}
.landing__group:nth-child(2) {
  transition-delay: 0.12s;
}
.landing__group:nth-child(3) {
  transition-delay: 0.24s;
}
/* Something to press inside a stage: outlined, so 開始使用 stays the page's one button. */
.landing__try {
  align-self: flex-start;
  min-height: 38px;
  padding: 0 var(--space-lg);
  border: 2px solid var(--color-primary);
  border-radius: var(--radius-pill);
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.landing__try:active {
  transform: scale(0.97);
}
/* 客人電話 and 兩個價錢: one large value that changes with the choice under it. */
.landing__reveal,
.landing__amount {
  padding: var(--space-lg);
  border-radius: 16px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}
.landing__reveal strong,
.landing__amount strong {
  display: block;
  margin-top: var(--space-xs);
  font-size: 26px;
  font-variant-numeric: tabular-nums;
}
.landing__reveal strong {
  color: var(--color-text-muted);
  transition: color 0.3s ease;
}
.landing__reveal--open strong {
  color: var(--color-text);
}
.landing__amount strong {
  color: var(--color-gold-ink);
}
.landing__reveal strong.landing__done {
  color: var(--status-confirmed);
}
/* 資料安全: one plain line of what is promised, under the picture. */
.landing__promise {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
  line-height: 1.6;
}
/* 接駁: two legs for the dispatcher, one line for the passenger. */
.landing__legs {
  display: flex;
  gap: var(--space-sm);
}
.landing__leg {
  flex: 1;
  min-width: 0;
  padding: var(--space-md);
  border-radius: 16px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  font-weight: 700;
}
.landing__leg em {
  display: block;
  margin-top: var(--space-xs);
  color: var(--color-teal);
  font-size: var(--font-label);
  font-style: normal;
}
@media (prefers-reduced-motion: reduce) {
  .landing__scene,
  .landing__points-play {
    transition: none;
  }
  .landing__link--ask,
  .landing__stage {
    animation: none;
  }
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
  font-size: 21px;
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
