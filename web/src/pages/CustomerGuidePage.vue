<script setup lang="ts">
import { useRouter } from 'vue-router';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';

/**
 * 名片頁與預約怎麼用: what the driver's own page is for, where to put its link so customers
 * find it, and what happens when one books. Shown to new drivers from the home page, and kept
 * under 我的 for later. Only what the tool does today: a link to copy, no posters or QR images.
 */
const router = useRouter();
// Vue Router records the previous in-app page; empty when the guide was opened on its own.
const cameFromPage = (window.history.state as { back?: unknown } | null)?.back === '/app/profile-page';

/** Read from the 名片頁: go back to it rather than stacking a second one on top. */
function toMyPage() {
  if (cameFromPage) router.back();
  else void router.push('/app/profile-page');
}

const STEPS = [
  { title: '做好你的名片頁', text: '放車輛照片、常走路線、會說的語言，再按公開。姓名和車型取自你的司機資料。' },
  { title: '把連結放出去', text: '複製名片頁的連結，貼到客人看得到的地方。' },
  { title: '客人預約，你報價', text: '客人不用下載、不用登入，填時間、路線、人數就送出。你收到後回一個價錢。' },
  { title: '客人同意，一按成單', text: '客人按同意後，你按「這單我自己做」就成為你的行程；做不了也可以派給其他司機。' },
];

const PLACES = [
  { where: '微信朋友圈', how: '發一條近況，把連結貼在文字裡。熟客點開就能預約。' },
  { where: '傳給熟客', how: '行程結束後傳一句「下次直接在這裡約我」，附上連結。' },
  { where: 'WhatsApp', how: '放在個人簡介或狀態，也可以直接傳給問價的人。' },
  { where: '小紅書、抖音', how: '貼文裡的連結點不開，把連結放在主頁簡介，或在私訊裡傳給問價的人。' },
  { where: '司機群', how: '同行有做不了的單時，知道你常走哪條線，會把客人介紹給你。' },
];

const TIPS = [
  '有車輛照片的名片頁，客人比較放心。',
  '常走路線寫清楚，例如「深圳灣 至 香港機場」，客人一看就知道找對人。',
  '收到預約盡快報價；客人常常同時問幾個司機。',
  '客人是你的：平台不抽成，也不會把你的客人派給別人。',
];
</script>

<template>
  <div class="page guide">
    <!-- Opened from 首頁, 我的, 預約 and the 名片頁: 返回 goes back to whichever it was. -->
    <PageBack :title="t('用名片頁找客人')" fallback="/app/me" history />

    <section class="guide__lead">
      <h2>{{ t('你自己的接單頁') }}</h2>
      <p>{{ t('名片頁是一條屬於你的連結。把它放到客人看得到的地方，客人就能直接向你預約，不用經過群，也不用經過別人。') }}</p>
    </section>

    <!-- A real sequence, so it reads as one line of stops. -->
    <ol class="guide__steps">
      <li v-for="(step, index) in STEPS" :key="step.title">
        <span class="guide__number">{{ index + 1 }}</span>
        <div>
          <strong>{{ t(step.title) }}</strong>
          <p>{{ t(step.text) }}</p>
        </div>
      </li>
    </ol>

    <section class="guide__section">
      <h2>{{ t('連結放在哪裡') }}</h2>
      <div v-for="place in PLACES" :key="place.where" class="guide__place">
        <strong>{{ t(place.where) }}</strong>
        <p>{{ t(place.how) }}</p>
      </div>
    </section>

    <section class="guide__section">
      <h2>{{ t('讓客人更願意約你') }}</h2>
      <ul class="guide__tips">
        <li v-for="tip in TIPS" :key="tip">{{ t(tip) }}</li>
      </ul>
    </section>

    <button class="button block large" type="button" @click="toMyPage">{{ t('去做我的名片頁') }}</button>
    <RouterLink class="guide__bookings" to="/app/bookings">{{ t('看收到的預約') }}</RouterLink>
  </div>
</template>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}
.guide h2 {
  margin: 0 0 var(--space-sm);
  font-size: 20px;
}
.guide__lead p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-body-large);
  line-height: 1.7;
}
.guide__steps {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  margin: 0;
  padding: 0;
}
.guide__steps li {
  display: flex;
  gap: var(--space-md);
}
.guide__number {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
}
.guide__steps strong,
.guide__place strong {
  font-size: var(--font-body-large);
}
.guide__steps p,
.guide__place p {
  margin: 2px 0 0;
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.guide__place {
  padding: var(--space-md) 0;
  border-top: 1px solid var(--color-divider);
}
.guide__place:first-of-type {
  border-top: none;
  padding-top: 0;
}
.guide__tips {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: 0;
  padding-left: 1.2em;
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.guide__bookings {
  align-self: center;
  font-weight: 600;
}
</style>
