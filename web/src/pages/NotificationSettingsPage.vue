<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import { alertPreference, playTone, TONES, unlockSound, type AlertTone } from '../alert-sound';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { toast } from '../toast';

type Group = 'DISPATCHED' | 'CLAIMED' | 'BOOKINGS' | 'SUPPORT';

/**
 * 通知設定: the sound is kept on this phone (like Master Travel); which notifications to receive
 * is kept with the account, and a group turned off is not recorded at all.
 */
const GROUPS: { key: Group; title: string; detail: string }[] = [
  { key: 'DISPATCHED', title: '我出的單', detail: '有司機接單、乘客確認行程、行程完成' },
  { key: 'CLAIMED', title: '我接的單', detail: '被取消、被改派、已結清、可以看乘客電話了' },
  { key: 'BOOKINGS', title: '名片頁預約', detail: '新預約、乘客同意報價、乘客取消' },
  { key: 'SUPPORT', title: '客服', detail: '客服回覆你' },
];

const sound = ref(alertPreference.sound);
const tone = ref<AlertTone>(alertPreference.tone);
const off = ref<Group[] | null>(null);
const error = ref('');

async function preview(which: AlertTone) {
  if (!(await unlockSound()) || !playTone(which)) toast('這個瀏覽器不能播放提示音');
}

async function setSound() {
  alertPreference.sound = sound.value;
  if (sound.value) await preview(tone.value);
}

async function setTone(which: AlertTone) {
  tone.value = which;
  alertPreference.tone = which;
  await preview(which);
}

async function toggle(key: Group, on: boolean) {
  if (!off.value) return;
  const before = off.value;
  off.value = on ? before.filter((group) => group !== key) : [...before, key];
  try {
    off.value = (await api<{ off: Group[] }>('PUT', '/me/notification-settings', { off: off.value })).off;
    toast('已更新');
  } catch {
    off.value = before;
    toast('更新失敗，請再試一次');
  }
}

onMounted(async () => {
  try {
    off.value = (await api<{ off: Group[] }>('GET', '/me/notification-settings')).off;
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('通知設定')" fallback="/app/notifications" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <section class="card settings__group">
      <span class="section-label">{{ t('這部手機') }}</span>
      <label class="settings__line">
        <span class="settings__text">
          {{ t('提示音和震動') }}
          <small>{{ t('打開 MasterDriver 後先點一下畫面，之後有新通知才會響。iPhone 靜音時不響，也不支援震動') }}</small>
        </span>
        <input v-model="sound" class="switch" type="checkbox" @change="setSound" />
      </label>
      <div v-if="sound" class="settings__line">
        <span class="settings__text">{{ t('提示音') }}</span>
        <span class="segment" role="group" :aria-label="t('提示音')">
          <button v-for="(shape, key) in TONES" :key="key" type="button" :aria-pressed="tone === key" @click="setTone(key)">
            {{ t(shape.label) }}
          </button>
        </span>
      </div>
    </section>

    <section v-if="off" class="card settings__group">
      <span class="section-label">{{ t('要收的通知') }}</span>
      <label v-for="group in GROUPS" :key="group.key" class="settings__line">
        <span class="settings__text">
          {{ t(group.title) }}
          <small>{{ t(group.detail) }}</small>
        </span>
        <input
          class="switch"
          type="checkbox"
          :checked="!off.includes(group.key)"
          @change="toggle(group.key, ($event.target as HTMLInputElement).checked)"
        />
      </label>
    </section>

    <p class="settings__note">
      {{ t('通知只在 MasterDriver 開著時收到。關掉頁面、切到其他 App 或手機鎖屏後收不到，下次打開時在通知列表看得到。') }}
    </p>
  </div>
</template>

<style scoped>
.settings__group {
  padding-top: var(--space-md);
  padding-bottom: var(--space-sm);
}
.settings__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 52px;
  padding: var(--space-sm) 0;
  font-weight: 600;
}
.settings__line + .settings__line {
  border-top: 1px solid var(--color-divider);
}
.settings__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.settings__text small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
  line-height: 1.5;
}
.settings__note {
  color: var(--color-text-secondary);
  font-size: var(--font-label);
  line-height: 1.7;
}
</style>
