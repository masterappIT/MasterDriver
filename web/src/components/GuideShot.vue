<script setup lang="ts">
import type { GuideShotName } from '../guides/content';
import { t } from '../i18n';

/**
 * A small drawn screen for one step of a 使用教學 page, made of the app's own cards and pills like
 * the 名片頁 guide's: no image files, nothing more to download in WeChat. Decoration only; the
 * step's words say the same (aria-hidden).
 */
defineProps<{ name: GuideShotName }>();
</script>

<template>
  <div class="shot" aria-hidden="true">
    <div v-if="name === 'login'" class="shot__mock">
      <strong>{{ t('用手機號碼登入') }}</strong>
      <div class="shot__field"><span class="shot__code">+852</span><span>6123 4567</span></div>
      <span class="shot__button">{{ t('取得驗證碼') }}</span>
      <div class="shot__digits"><span v-for="digit in ['3', '8', '1', '0', '5', '6']" :key="digit">{{ digit }}</span></div>
    </div>

    <div v-else-if="name === 'profile'" class="shot__mock">
      <div class="shot__row"><span>{{ t('姓名或稱呼') }}</span><strong>{{ t('陳師傅') }}</strong></div>
      <div class="shot__row"><span>{{ t('車牌類型') }}</span><strong>{{ t('兩地牌') }}</strong></div>
      <div class="shot__row"><span>{{ t('車型') }}</span><strong>{{ t('7座商務車') }}</strong></div>
      <span class="shot__button">{{ t('儲存') }}</span>
    </div>

    <div v-else-if="name === 'home-screen'" class="shot__screen">
      <span class="shot__icon"></span>
      <span class="shot__icon"></span>
      <span class="shot__icon shot__icon--ours">{{ t('師傅幫') }}</span>
      <span class="shot__icon"></span>
    </div>

    <div v-else-if="name === 'quick'" class="shot__mock">
      <div class="shot__paste">{{ t('明天15:40澳門送香港 直車 7座') }}</div>
      <span class="shot__button">{{ t('自動填入') }}</span>
      <div class="shot__chips">
        <span>{{ t('明天 15:40') }}</span>
        <span>{{ t('澳門 至 香港') }}</span>
        <span>{{ t('7座') }}</span>
      </div>
    </div>

    <div v-else-if="name === 'kinds'" class="shot__mock">
      <div class="shot__segments">
        <span>{{ t('直達') }}</span>
        <span>{{ t('往返') }}</span>
        <span class="on">{{ t('接駁') }}</span>
      </div>
      <div class="shot__legs">
        <span>{{ t('第 1 段') }}</span>
        <i></i>
        <strong>{{ t('接駁位置') }}</strong>
        <i></i>
        <span>{{ t('第 2 段') }}</span>
      </div>
    </div>

    <div v-else-if="name === 'share' || name === 'deal-share'" class="shot__bubble">
      <template v-if="name === 'share'">
        <strong>{{ t('【有單】10/25（日）15:40') }}</strong>
        <span>{{ t('澳門 → 香港') }}</span>
        <span>{{ t('2人｜2件行李｜7座') }}</span>
        <span>RMB¥400</span>
        <span class="shot__link">{{ t('搶單：') }}masterdriverapp…/o/…</span>
      </template>
      <template v-else>
        <strong>{{ t('【特價車】10/25（日）16:00') }}</strong>
        <span>{{ t('深圳灣口岸 → 香港國際機場') }}</span>
        <span>{{ t('包車 RMB¥350（原價 RMB¥500）') }}</span>
        <span>{{ t('點開預約，不用註冊') }}</span>
        <span class="shot__link">masterdriverapp…/d/…</span>
      </template>
    </div>

    <div v-else-if="name === 'dispatched'" class="shot__mock">
      <span class="shot__tag shot__tag--done">{{ t('已有人接') }}</span>
      <strong>{{ t('司機：李師傅') }}</strong>
      <span class="shot__button">{{ t('複製「已派出」貼回群') }}</span>
    </div>

    <div v-else-if="name === 'claim'" class="shot__mock">
      <strong class="shot__time">{{ t('10/25（日）15:40') }}</strong>
      <span class="shot__route">{{ t('澳門 至 香港') }}</span>
      <span class="shot__muted">{{ t('2人・2件行李・7座') }}</span>
      <div class="shot__price">
        <span>{{ t('出單價') }}</span>
        <strong>RMB¥400</strong>
      </div>
      <span class="shot__button">{{ t('立即搶單') }}</span>
    </div>

    <div v-else-if="name === 'claimed'" class="shot__mock">
      <span class="shot__tag shot__tag--done">{{ t('你接到這張單了') }}</span>
      <span class="shot__button">{{ t('已出發') }}</span>
      <span class="shot__button shot__button--secondary">{{ t('已到上車點') }}</span>
      <span class="shot__button shot__button--secondary">{{ t('乘客已上車') }}</span>
    </div>

    <div v-else-if="name === 'pool'" class="shot__mock">
      <div class="shot__segments">
        <span class="on">{{ t('今天') }}</span>
        <span>{{ t('明天') }}</span>
        <span>{{ t('其他日子') }}</span>
      </div>
      <div class="shot__line"><strong>18:00</strong><span>{{ t('深圳灣 至 香港機場') }}</span></div>
      <div class="shot__line"><strong>21:30</strong><span>{{ t('珠海 至 澳門') }}</span></div>
    </div>

    <div v-else-if="name === 'deal-form'" class="shot__mock">
      <span class="shot__route">{{ t('深圳灣口岸 → 香港國際機場') }}</span>
      <span class="shot__muted">{{ t('10/25（日）09:00 至 18:00，乘客自己選時間') }}</span>
      <div class="shot__price">
        <span>{{ t('包車特價（每組）') }}</span>
        <span><s>RMB¥500</s> <strong>RMB¥350</strong></span>
      </div>
      <span class="shot__button">{{ t('發特價車，取得連結') }}</span>
    </div>

    <div v-else-if="name === 'deal-split'" class="shot__mock">
      <span class="shot__tag shot__tag--wait">{{ t('等你確認') }}</span>
      <strong>{{ t('王小姐・2人・10/25（日）14:00') }}</strong>
      <span class="shot__button">{{ t('這單我自己做') }}</span>
      <span class="shot__button shot__button--secondary">{{ t('派給其他司機') }}</span>
    </div>
  </div>
</template>

<style scoped>
/* A tinted stage with a small screen on it, as in the 名片頁 guide. */
.shot {
  display: flex;
  justify-content: center;
  padding: var(--space-lg) var(--space-lg) var(--space-md);
  background: linear-gradient(135deg, var(--color-tint), rgba(14, 159, 154, 0.12));
}
.shot__mock {
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
.shot__field,
.shot__row,
.shot__price,
.shot__line {
  display: flex;
  align-self: stretch;
  justify-content: space-between;
  gap: var(--space-sm);
}
.shot__field {
  justify-content: flex-start;
  padding: 6px var(--space-sm);
  border: 1px solid var(--color-divider);
  border-radius: 8px;
}
.shot__code {
  color: var(--color-text-secondary);
}
.shot__row {
  padding: 2px 0;
  border-bottom: 1px solid var(--color-divider);
}
.shot__row span,
.shot__muted {
  color: var(--color-text-secondary);
}
.shot__line {
  justify-content: flex-start;
  padding: 6px var(--space-sm);
  border-radius: 8px;
  background: var(--color-tint);
}
.shot__digits {
  display: flex;
  gap: 4px;
}
.shot__digits span {
  width: 22px;
  padding: 2px 0;
  border: 1px solid var(--color-divider);
  border-radius: 6px;
  text-align: center;
  font-weight: 700;
}
.shot__paste {
  align-self: stretch;
  padding: var(--space-sm);
  border: 1px dashed var(--color-primary);
  border-radius: 8px;
  color: var(--color-text);
}
.shot__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.shot__chips span {
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font-weight: 600;
}
.shot__segments {
  display: flex;
  align-self: stretch;
  padding: 2px;
  border-radius: var(--radius-pill);
  background: var(--color-tint);
}
.shot__segments span {
  flex: 1;
  padding: 3px 0;
  border-radius: var(--radius-pill);
  color: var(--color-primary-dark);
  text-align: center;
}
.shot__segments span.on {
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
}
.shot__legs {
  display: flex;
  align-self: stretch;
  align-items: center;
  gap: 4px;
  margin-top: var(--space-xs);
}
.shot__legs i {
  flex: 1;
  height: 2px;
  background: var(--color-primary);
}
.shot__legs strong {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.shot__button {
  align-self: stretch;
  margin-top: var(--space-xs);
  padding: 6px 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
  text-align: center;
}
.shot__button--secondary {
  background: var(--color-tint);
  color: var(--color-primary-dark);
}
.shot__time {
  font-size: var(--font-body);
}
.shot__route {
  font-weight: 700;
}
.shot__price {
  margin-top: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--color-divider);
}
.shot__price strong {
  color: var(--color-gold-ink);
}
.shot__price s {
  color: var(--color-text-muted);
}
.shot__tag {
  padding: 1px var(--space-sm);
  border-radius: var(--radius-pill);
  font-weight: 700;
}
.shot__tag--wait {
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
}
.shot__tag--done {
  background: var(--status-confirmed-tint);
  color: var(--status-confirmed);
}
/* A chat bubble with the link in it, as it looks in WeChat or WhatsApp. */
.shot__bubble {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 250px;
  margin-left: auto;
  padding: var(--space-sm) var(--space-md);
  border-radius: 14px 14px 4px 14px;
  background: #95ec69;
  color: #142033;
  font-size: var(--font-caption);
}
.shot__link {
  color: #1f5fd6;
  text-decoration: underline;
}
/* A phone's home screen: four app icons, ours among them. */
.shot__screen {
  display: grid;
  grid-template-columns: repeat(4, 48px);
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: 18px;
  background: #1c2a40;
}
.shot__icon {
  display: grid;
  place-items: end center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding-bottom: 4px;
}
.shot__icon--ours {
  background: linear-gradient(135deg, var(--color-primary), var(--color-teal));
}
</style>
