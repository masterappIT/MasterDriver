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
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <h1>一般設定</h1>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="message" class="notice">{{ message }}</div>
  <form class="general-settings" @submit.prevent="save">
    <div class="card general-settings__card">
      <h2>升級入口</h2>
      <label class="field">
        Master Travel 預約演示連結（所有升級提示和預設廣告都連到這裡）
        <input v-model="form.upgradeUrl" class="input" placeholder="https://" />
      </label>
    </div>

    <div class="card general-settings__card">
      <h2>客服聯絡</h2>
      <div class="row">
        <label class="field">微信號<input v-model="form.supportWechatId" class="input" /></label>
        <label class="field">WhatsApp 號碼<input v-model="form.supportWhatsapp" class="input" placeholder="+852 …" /></label>
      </div>
    </div>

    <div class="card general-settings__card">
      <h2>公告</h2>
      <label class="field">公告文字（顯示在司機端頂部）<input v-model="form.announcementText" class="input" maxlength="300" /></label>
      <label class="row"><input v-model="form.announcementEnabled" type="checkbox" /> 顯示公告</label>
    </div>

    <div class="card general-settings__card">
      <h2>服務條款與私隱政策</h2>
      <label class="field">服務條款<textarea v-model="form.termsText" class="input general-settings__text" /></label>
      <label class="field">私隱政策<textarea v-model="form.privacyText" class="input general-settings__text" /></label>
      <p class="hint">上線前請律師審閱條款內容，特別是平台服務費與兩地個人資料的部分。</p>
    </div>

    <div class="row">
      <button class="button" type="submit">儲存全部</button>
      <span v-if="meta" class="hint">最後修改：{{ dateTime(meta.updatedAt) }}　{{ meta.updatedBy ?? '' }}</span>
    </div>
  </form>
</template>

<style scoped>
.general-settings__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.general-settings__text {
  min-height: 160px;
  resize: vertical;
}
</style>
