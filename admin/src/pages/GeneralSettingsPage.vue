<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { dateTime } from '../format';

interface Setting {
  upgradeUrl: string;
  supportWechatId: string;
  supportWhatsapp: string;
  termsText: string;
  privacyText: string;
  announcementText: string;
  announcementEnabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

const form = reactive({
  upgradeUrl: '',
  supportWechatId: '',
  supportWhatsapp: '',
  termsText: '',
  privacyText: '',
  announcementText: '',
  announcementEnabled: false,
});
const meta = ref<{ updatedAt: string; updatedBy: string | null } | null>(null);
const error = ref('');
const message = ref('');
const logoUrl = ref<string | null>(null);
const LOGO_MAX_BYTES = 400 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  message.value = '';
  if (file.size > LOGO_MAX_BYTES) {
    error.value = `Logo 檔案太大（${Math.round(file.size / 1024)} KB），上限 400 KB`;
    return;
  }
  try {
    logoUrl.value = (await api<{ logoUrl: string | null }>('PUT', '/settings/logo', { image: await readAsDataUrl(file) })).logoUrl;
    message.value = 'Logo 已更新';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function removeLogo() {
  if (!confirm('確定移除 Logo？移除後公開頁面改為顯示文字標題。')) return;
  error.value = '';
  message.value = '';
  try {
    logoUrl.value = (await api<{ logoUrl: string | null }>('DELETE', '/settings/logo')).logoUrl;
    message.value = 'Logo 已移除';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/** 更新說明彈窗: a picture every driver sees once in the app; a new picture shows again to everyone. */
interface UpdateNotice {
  enabled: boolean;
  version: number;
  images: { hant: string | null; hans: string | null };
  seen: number;
  users: number;
  updatedAt: string;
}
const notice = ref<UpdateNotice | null>(null);

async function uploadNotice(language: 'zh-Hant' | 'zh-Hans', event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  message.value = '';
  if (file.size > LOGO_MAX_BYTES) {
    error.value = `圖片檔案太大（${Math.round(file.size / 1024)} KB），上限 400 KB`;
    return;
  }
  if (notice.value?.enabled && !confirm('換了新圖片，所有司機會再看到一次。確定上傳？')) return;
  try {
    notice.value = await api<UpdateNotice>('PUT', '/settings/update-notice/image', { language, image: await readAsDataUrl(file) });
    message.value = language === 'zh-Hans' ? '簡體圖片已更新' : '繁體圖片已更新';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function setNoticeEnabled(enabled: boolean) {
  error.value = '';
  message.value = '';
  try {
    notice.value = await api<UpdateNotice>('PUT', '/settings/update-notice', { enabled });
    message.value = enabled ? '更新說明彈窗已開啟' : '更新說明彈窗已關閉';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function fill(setting: Setting) {
  const { updatedAt, updatedBy, ...fields } = setting;
  Object.assign(form, Object.fromEntries(Object.keys(form).map((key) => [key, fields[key as keyof typeof fields]])));
  meta.value = { updatedAt, updatedBy };
}

async function save() {
  error.value = '';
  message.value = '';
  try {
    fill(await api<Setting>('PUT', '/settings/general', { ...form }));
    message.value = '已儲存';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  try {
    fill(await api<Setting>('GET', '/settings/general'));
    logoUrl.value = (await api<{ logoUrl: string | null }>('GET', '/settings/logo')).logoUrl;
    notice.value = await api<UpdateNotice>('GET', '/settings/update-notice');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div class="settings-page">
    <h1>一般設定</h1>
    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice">{{ message }}</div>
    <div class="split general-settings__split">
    <div class="card general-settings__card">
      <h2>Logo</h2>
      <p class="muted">顯示在平台首頁、登入頁和搶單頁的頁首。沒有上傳時顯示文字「MasterDriver」。</p>
      <div class="row">
        <img v-if="logoUrl" class="general-settings__logo" :src="logoUrl" alt="目前的 Logo" />
        <span v-else class="hint">尚未上傳</span>
        <label class="button secondary general-settings__upload">
          {{ logoUrl ? '更換 Logo' : '上傳 Logo' }}
          <input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadLogo" />
        </label>
        <button v-if="logoUrl" class="button secondary" type="button" @click="removeLogo">移除</button>
      </div>
      <p class="hint">PNG、JPG 或 WebP，400 KB 以內；建議使用透明背景的 PNG，高度至少 96 px。上傳後立即生效，不用按「儲存全部」。</p>
    </div>

      <div class="card general-settings__card">
        <h2>升級入口</h2>
        <label class="field">
          Master Travel 預約演示連結（所有升級提示和預設廣告都連到這裡）
          <input v-model="form.upgradeUrl" class="input" placeholder="https://" form="general-settings-form" />
        </label>
      </div>
    </div>

    <div v-if="notice" class="card general-settings__card general-settings__notice">
      <h2>更新說明彈窗</h2>
      <p class="muted">司機登入後在司機端彈出一張圖片，可以關掉；每個帳號只看一次，換手機也不會再出現。換新圖片後，所有司機會再看到一次。</p>
      <div class="general-settings__notice-images">
        <div v-for="item in ([['zh-Hant', '繁體圖片（必須）', notice.images.hant], ['zh-Hans', '簡體圖片（內地號碼的司機看到；沒有就看繁體）', notice.images.hans]] as const)" :key="item[0]" class="general-settings__notice-image">
          <span class="hint">{{ item[1] }}</span>
          <img v-if="item[2]" :src="item[2]" :alt="item[1]" />
          <span v-else class="general-settings__notice-empty">尚未上傳</span>
          <label class="button secondary general-settings__upload">
            {{ item[2] ? '更換圖片' : '上傳圖片' }}
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadNotice(item[0], $event)" />
          </label>
        </div>
      </div>
      <label class="row"><input type="checkbox" :checked="notice.enabled" :disabled="!notice.images.hant" @change="setNoticeEnabled(($event.target as HTMLInputElement).checked)" /> 顯示更新說明彈窗</label>
      <p class="hint">
        {{ notice.version ? `已有 ${notice.seen} 位司機看過這次的更新說明（共 ${notice.users} 位司機）。` : '還沒有上傳過圖片。' }}
        PNG、JPG 或 WebP，400 KB 以內，建議直向 3:4。上傳和開關都立即生效，不用按「儲存全部」。
      </p>
    </div>

    <form id="general-settings-form" class="general-settings" @submit.prevent="save">
      <div class="split">
        <div class="card general-settings__card">
          <h2>客服聯絡</h2>
          <div class="form-grid">
            <label class="field">微信號<input v-model="form.supportWechatId" class="input" /></label>
            <label class="field">WhatsApp 號碼<input v-model="form.supportWhatsapp" class="input" placeholder="+852 …" /></label>
          </div>
        </div>

        <div class="card general-settings__card">
          <h2>公告</h2>
          <label class="field">公告文字（顯示在司機端頂部）<input v-model="form.announcementText" class="input" maxlength="300" /></label>
          <label class="row"><input v-model="form.announcementEnabled" type="checkbox" /> 顯示公告</label>
        </div>
      </div>

      <div class="card general-settings__card">
        <h2>服務條款與私隱政策</h2>
        <div class="form-grid general-settings__texts">
          <label class="field">服務條款<textarea v-model="form.termsText" class="input general-settings__text" /></label>
          <label class="field">私隱政策<textarea v-model="form.privacyText" class="input general-settings__text" /></label>
        </div>
        <p class="hint">上線前請律師審閱條款內容，特別是平台服務費與兩地個人資料的部分。</p>
      </div>

      <div class="form-foot general-settings__foot">
        <button class="button" type="submit">儲存全部</button>
        <span v-if="meta" class="hint">最後修改：{{ dateTime(meta.updatedAt) }}　{{ meta.updatedBy ?? '' }}</span>
      </div>
    </form>
  </div>
</template>

<style scoped>
.general-settings__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* The card's gap spaces its lines; paragraphs add none of their own. */
.general-settings__card > p,
.general-settings__card > h2 {
  margin: 0;
}

/* Side by side cards are as tall as each other. */
.general-settings__split {
  align-items: stretch;
  margin-bottom: 18px;
}

.general-settings .split {
  align-items: stretch;
}

.general-settings__texts {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

/* 儲存全部 saves every card above, so it sits below them, not inside one. */
.general-settings__foot {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.general-settings__logo {
  max-height: 64px;
  max-width: 240px;
}

.general-settings__upload {
  cursor: pointer;
}

.general-settings__notice {
  margin-bottom: 18px;
}

.general-settings__notice-images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-md);
}

.general-settings__notice-image {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
}

.general-settings__notice-image img {
  width: 180px;
  border-radius: 12px;
  border: 1px solid var(--color-border, #d3dce7);
}

.general-settings__notice-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 224px;
  border: 1px dashed var(--color-border, #d3dce7);
  border-radius: 12px;
  color: var(--color-text-secondary, #556579);
}

.general-settings__upload input {
  display: none;
}

.general-settings__text {
  min-height: 160px;
  resize: vertical;
}
</style>
