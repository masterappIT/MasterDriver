<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  APP_INTEREST_CHOICES,
  APP_INTEREST_NAMES,
  APP_INTEREST_NOTE_MAX,
  validAppInterest,
  type AppInterestChoice,
} from '@masterdriver/shared/app-interest';
import { api, session } from '../api';
import { t } from '../i18n';
import { popups } from '../popups';
import { toast } from '../toast';
import AppIcon from './AppIcon.vue';

/**
 * App 意向問卷: whether drivers want a WeChat mini program or an app, asked once per account when
 * the platform switched it on in 一般設定. 略過 is an answer too, so it is never asked again; there is
 * no other way to close it, so a stray tap never loses the question.
 */
const route = useRoute();
const asking = ref(false);
const choices = ref<AppInterestChoice[]>([]);
const note = ref('');
const sending = ref(false);
let askedFor: string | null = null;

// Asked once for each signed-in driver, once the 更新說明彈窗 is out of the way (none, or closed).
watch(
  () => [session.user?.id ?? null, Boolean(session.profile), Boolean(route.meta.app), popups.updateNotice] as const,
  async ([userId, hasProfile, inApp, updateNotice]) => {
    if (!userId || !hasProfile || !inApp || updateNotice !== 'none' || askedFor === userId) return;
    askedFor = userId;
    try {
      asking.value = (await api<{ ask: boolean }>('GET', '/me/app-interest')).ask;
    } catch {
      asking.value = false;
    }
  },
  { immediate: true },
);

/** 網頁就夠 stands alone: choosing it clears the others, and choosing another clears it. */
function toggle(choice: AppInterestChoice) {
  if (choices.value.includes(choice)) choices.value = choices.value.filter((one) => one !== choice);
  else if (choice === 'WEB_ENOUGH') choices.value = [choice];
  else choices.value = [...choices.value.filter((one) => one !== 'WEB_ENOUGH'), choice];
}

async function send(skipped: boolean) {
  if (sending.value || (!skipped && !validAppInterest(choices.value))) return;
  sending.value = true;
  try {
    await api('POST', '/me/app-interest', skipped ? { skipped } : { skipped, choices: choices.value, note: note.value.trim() });
    asking.value = false;
    if (!skipped) toast('謝謝你的意見');
  } catch {
    if (skipped) asking.value = false; // asked again next time, which is better than being stuck
    else toast('沒有送出，請再試一次');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div v-if="asking && route.meta.app" class="app-interest" role="dialog" aria-modal="true" aria-labelledby="app-interest-title">
    <section class="app-interest__panel">
      <h2 id="app-interest-title">{{ t('你希望 MasterDriver 出哪一種？') }}</h2>
      <p class="app-interest__lead">{{ t('可以多選。你的選擇決定我們先做哪一個。') }}</p>

      <div class="app-interest__choices">
        <button
          v-for="choice in APP_INTEREST_CHOICES"
          :key="choice"
          class="app-interest__choice"
          :class="{ 'app-interest__choice--on': choices.includes(choice) }"
          type="button"
          :aria-pressed="choices.includes(choice)"
          @click="toggle(choice)"
        >
          <span class="app-interest__box"><AppIcon v-if="choices.includes(choice)" name="check" :size="24" /></span>
          {{ t(APP_INTEREST_NAMES[choice]) }}
        </button>
      </div>

      <label class="field app-interest__note">
        {{ t('其他建議（選填）') }}
        <textarea v-model="note" class="textarea" :maxlength="APP_INTEREST_NOTE_MAX" rows="2" />
      </label>

      <button class="button block large" type="button" :disabled="sending || !validAppInterest(choices)" @click="send(false)">{{ t('送出') }}</button>
      <button class="app-interest__skip" type="button" :disabled="sending" @click="send(true)">{{ t('略過') }}</button>
    </section>
  </div>
</template>

<style scoped>
.app-interest {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(23, 35, 61, 0.45);
}
.app-interest__panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--max-width);
  max-height: 92vh;
  overflow-y: auto;
  padding: var(--space-xl) var(--space-lg) calc(var(--space-md) + var(--safe-bottom));
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  background: var(--color-surface);
}
.app-interest__panel h2 {
  margin: 0;
}
.app-interest__lead {
  margin: var(--space-xs) 0 var(--space-lg);
  color: var(--color-text-secondary);
}
.app-interest__choices {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}
.app-interest__choice {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-height: 52px;
  padding: var(--space-sm) var(--space-lg);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-input);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-body-large);
  text-align: left;
  cursor: pointer;
}
.app-interest__choice--on {
  border-color: var(--color-primary);
  background: var(--color-tint);
}
.app-interest__box {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  border: 1.5px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-primary);
}
/* The icon is a ticked circle; it takes the box's place rather than sitting in it. */
.app-interest__choice--on .app-interest__box {
  border: none;
}
.app-interest__skip {
  min-height: 44px;
  margin-top: var(--space-xs);
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  cursor: pointer;
}
</style>
