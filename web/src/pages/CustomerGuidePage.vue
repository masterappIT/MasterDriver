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

/** Where drivers put the link, as short chips under step 2. */
const PLACES = ['微信朋友圈', '傳給熟客', 'WhatsApp', '小紅書主頁簡介', '司機群'];
const TIPS = ['放車輛照片，客人比較放心', '常走路線寫清楚', '收到預約盡快報價'];
</script>

<template>
  <div class="page guide">
    <!-- Opened from 首頁, 我的, 預約 and the 名片頁: 返回 goes back to whichever it was. -->
    <PageBack :title="t('用名片頁找客人')" fallback="/app/me" history />

    <p class="guide__lead">{{ t('一條屬於你的連結，客人直接向你預約。') }}</p>

    <!--
      Four steps, each a small picture of the screen it is about and one line under it. The
      pictures are drawn with the app's own cards (no image files, nothing to download in WeChat)
      and are decoration only: the line under each says the step.
    -->
    <ol class="guide__steps">
      <li class="guide__step">
        <div class="guide__shot" aria-hidden="true">
          <div class="guide__mock">
            <div class="guide__mock-head">
              <span class="guide__avatar"></span>
              <div>
                <strong>{{ t('張師傅') }}</strong>
                <span>{{ t('7座商務車・黑') }}</span>
              </div>
            </div>
            <div class="guide__chips">
              <span>{{ t('深圳灣 至 香港機場') }}</span>
              <span>{{ t('粵語') }}</span>
            </div>
            <span class="guide__mock-button">{{ t('預約這位師傅') }}</span>
          </div>
        </div>
        <div class="guide__caption">
          <span class="guide__number">1</span>
          <div>
            <strong>{{ t('做好名片頁') }}</strong>
            <p>{{ t('放照片、路線，按公開') }}</p>
          </div>
        </div>
      </li>

      <li class="guide__step">
        <div class="guide__shot" aria-hidden="true">
          <div class="guide__bubble">
            <span>{{ t('下次直接在這裡約我') }}</span>
            <span class="guide__link">masterdriverapp…/p/…</span>
          </div>
        </div>
        <div class="guide__caption">
          <span class="guide__number">2</span>
          <div>
            <strong>{{ t('把連結放出去') }}</strong>
            <div class="guide__places">
              <span v-for="place in PLACES" :key="place">{{ t(place) }}</span>
            </div>
          </div>
        </div>
      </li>

      <li class="guide__step">
        <div class="guide__shot" aria-hidden="true">
          <div class="guide__mock">
            <span class="guide__tag guide__tag--wait">{{ t('待回覆') }}</span>
            <strong class="guide__mock-time">{{ t('10/20（二）10:00') }}</strong>
            <span class="guide__mock-route">{{ t('深圳灣口岸 至 香港機場') }}</span>
            <div class="guide__mock-price">
              <span>{{ t('你的報價') }}</span>
              <strong>HK$500</strong>
            </div>
          </div>
        </div>
        <div class="guide__caption">
          <span class="guide__number">3</span>
          <div>
            <strong>{{ t('客人預約，你報價') }}</strong>
            <p>{{ t('客人不用下載、不用登入') }}</p>
          </div>
        </div>
      </li>

      <li class="guide__step">
        <div class="guide__shot" aria-hidden="true">
          <div class="guide__mock">
            <span class="guide__tag guide__tag--agreed">{{ t('乘客已同意') }}</span>
            <span class="guide__mock-button">{{ t('這單我自己做') }}</span>
            <span class="guide__mock-button guide__mock-button--secondary">{{ t('派給其他司機') }}</span>
          </div>
        </div>
        <div class="guide__caption">
          <span class="guide__number">4</span>
          <div>
            <strong>{{ t('客人同意，一按成單') }}</strong>
            <p>{{ t('自己做，或派給其他司機') }}</p>
          </div>
        </div>
      </li>
    </ol>

    <section class="guide__tips">
      <span class="section-label">{{ t('小提示') }}</span>
      <ul>
        <li v-for="tip in TIPS" :key="tip">{{ t(tip) }}</li>
      </ul>
      <p class="hint">{{ t('客人是你的：平台不抽成，也不會把你的客人派給別人。') }}</p>
    </section>

    <button class="button block large" type="button" @click="toMyPage">{{ t('去做我的名片頁') }}</button>
    <RouterLink class="guide__bookings" to="/app/bookings">{{ t('看收到的預約') }}</RouterLink>
  </div>
</template>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.guide__lead {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-body-large);
}
.guide__steps {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  margin: 0;
  padding: 0;
}
.guide__step {
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-card);
  border: 1px solid var(--color-card-border);
}
/* The picture: a tinted stage with a small screen on it. */
.guide__shot {
  display: flex;
  justify-content: center;
  padding: var(--space-lg) var(--space-lg) var(--space-md);
  background: linear-gradient(135deg, var(--color-tint), rgba(14, 159, 154, 0.12));
}
.guide__mock {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  width: 100%;
  max-width: 260px;
  padding: var(--space-md);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
  font-size: var(--font-caption);
}
.guide__mock-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.guide__mock-head div {
  display: flex;
  flex-direction: column;
}
.guide__mock-head span {
  color: var(--color-text-secondary);
}
.guide__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-teal));
}
.guide__chips,
.guide__places {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.guide__chips span,
.guide__places span {
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font-size: var(--font-caption);
  font-weight: 600;
}
.guide__places {
  margin-top: var(--space-xs);
}
.guide__mock-button {
  align-self: stretch;
  margin-top: var(--space-xs);
  padding: 6px 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
  text-align: center;
}
.guide__mock-button--secondary {
  background: var(--color-tint);
  color: var(--color-primary-dark);
}
.guide__mock-time {
  font-size: var(--font-body);
}
.guide__mock-route {
  font-weight: 700;
}
.guide__mock-price {
  display: flex;
  align-self: stretch;
  justify-content: space-between;
  margin-top: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--color-divider);
}
.guide__mock-price strong {
  color: var(--color-gold-ink);
}
.guide__tag {
  padding: 1px var(--space-sm);
  border-radius: var(--radius-pill);
  font-weight: 700;
}
.guide__tag--wait {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.guide__tag--agreed {
  background: var(--status-confirmed-tint);
  color: var(--status-confirmed);
}
/* A chat bubble with the link in it, as it looks in WeChat or WhatsApp. */
.guide__bubble {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 240px;
  margin-left: auto;
  padding: var(--space-sm) var(--space-md);
  border-radius: 14px 14px 4px 14px;
  background: #95ec69;
  color: #142033;
  font-size: var(--font-caption);
}
.guide__link {
  color: #1f5fd6;
  text-decoration: underline;
}
.guide__caption {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg) var(--space-lg);
}
.guide__caption strong {
  font-size: var(--font-body-large);
}
.guide__caption p {
  margin: 2px 0 0;
  color: var(--color-text-secondary);
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
.guide__tips ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: var(--space-sm) 0;
  padding-left: 1.2em;
  color: var(--color-text-secondary);
}
.guide__tips .hint {
  margin: 0;
}
.guide__bookings {
  align-self: center;
  font-weight: 600;
}
</style>
