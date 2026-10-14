<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, errorText } from '../api';
import { shortTime } from '../format';
import { imageForUpload } from '../image';
import AppIcon from './AppIcon.vue';
import { t } from '../i18n';
import { toast } from '../toast';

type Platform = 'WECHAT' | 'WHATSAPP' | 'WECHAT_CONTACT';

interface Invite {
  id: string;
  platform: Platform;
  name: string;
  inviteUrl: string | null;
  qrUrl: string | null;
  expiresAt: string | null;
  expired: boolean;
  showOnClaimPage: boolean;
}

const KIND: Record<Platform, { label: string; hint: string }> = {
  WECHAT_CONTACT: { label: '我的微信二維碼（加我拉你入群）', hint: '不會過期，200 人以上的大群也適用。' },
  WECHAT: { label: '微信群二維碼', hint: '微信群二維碼 7 天後失效，200 人以上的群不能掃碼加入。' },
  WHATSAPP: { label: 'WhatsApp 群邀請連結', hint: '在 WhatsApp 群資料 →「透過連結邀請」複製。' },
};
/** Groups added before the name stopped being asked keep theirs. */
const titleOf = (invite: Invite) => invite.name || KIND[invite.platform].label;

const invites = ref<Invite[]>([]);
const adding = ref(false);
const busy = ref(false);
const error = ref('');
const form = reactive({ platform: 'WECHAT_CONTACT' as Platform, inviteUrl: '', qrImage: '' });

async function run(action: () => Promise<Invite[]>, done?: string) {
  error.value = '';
  busy.value = true;
  try {
    invites.value = await action();
    if (done) toast(done);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function pick(event: Event, target: (dataUrl: string) => void) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    target(await imageForUpload(file));
  } catch {
    error.value = t('無法讀取這張圖片');
  }
}

function add() {
  return run(async () => {
    const result = await api<Invite[]>('POST', '/me/group-invites', {
      platform: form.platform,
      ...(form.platform === 'WHATSAPP' ? { inviteUrl: form.inviteUrl } : { qrImage: form.qrImage }),
    });
    Object.assign(form, { inviteUrl: '', qrImage: '' });
    adding.value = false;
    return result;
  }, '已加入');
}

const toggle = (invite: Invite) => run(() => api('PATCH', `/me/group-invites/${invite.id}`, { showOnClaimPage: !invite.showOnClaimPage }));

const replaceQr = (invite: Invite, event: Event) =>
  pick(event, (qrImage) => void run(() => api('PATCH', `/me/group-invites/${invite.id}`, { qrImage }), '已更新二維碼'));

function remove(invite: Invite) {
  if (!confirm(t(`刪除「${titleOf(invite)}」？`))) return;
  return run(() => api('DELETE', `/me/group-invites/${invite.id}`), '已刪除');
}

/** Known only once the list has been read, so the one-line form does not flash before it. */
const loaded = ref(false);

onMounted(async () => {
  await run(() => api<Invite[]>('GET', '/me/group-invites'));
  loaded.value = true;
});
</script>

<template>
  <!-- With no group yet it is one line; it opens into the full section when the driver adds one. -->
  <section v-if="loaded && invites.length === 0 && !adding && !error" class="card group-invites--none">
    <button class="group-invites__open" type="button" @click="adding = true">
      <AppIcon name="people" class="group-invites__icon" />
      <span class="group-invites__text">
        <strong>{{ t('我的派單群') }}</strong>
        <small>{{ t('還沒加入。加了之後，搶單的司機可以找到你的群') }}</small>
      </span>
      <AppIcon name="chevron" class="group-invites__arrow" />
    </button>
  </section>
  <section v-else class="card">
    <span class="section-label">{{ t('我的派單群') }}</span>
    <p class="hint">{{ t('司機點開你的搶單連結時，可以按「加入派單群」找到你的群。最多 5 個。') }}</p>
    <div v-if="error" class="notice error">{{ error }}</div>

    <div v-for="invite in invites" :key="invite.id" class="group-invite">
      <img v-if="invite.qrUrl && !invite.expired" :src="invite.qrUrl" alt="" class="group-invite__qr" />
      <div class="group-invite__body">
        <strong>{{ t(titleOf(invite)) }}</strong>
        <span v-if="invite.name" class="hint">{{ t(KIND[invite.platform].label) }}</span>
        <span v-if="invite.expired" class="group-invite__warn">{{ t('二維碼已過期，請重新上傳') }}</span>
        <span v-else-if="invite.expiresAt" class="hint">{{ t(`${shortTime(invite.expiresAt)} 過期`) }}</span>
        <label class="row hint"><input type="checkbox" :checked="invite.showOnClaimPage" @change="toggle(invite)" /> {{ t('在我的搶單頁顯示') }}</label>
        <div class="row">
          <label v-if="invite.platform !== 'WHATSAPP'" class="chip">
            {{ t('換二維碼') }}<input type="file" accept="image/*" hidden @change="(event) => replaceQr(invite, event)" />
          </label>
          <button class="chip" type="button" @click="remove(invite)">{{ t('刪除') }}</button>
        </div>
      </div>
    </div>

    <form v-if="adding" class="group-invite__form" @submit.prevent="add">
      <label class="field">
        {{ t('類型') }}
        <select v-model="form.platform" class="select">
          <option v-for="(kind, key) in KIND" :key="key" :value="key">{{ t(kind.label) }}</option>
        </select>
        <span class="hint">{{ t(KIND[form.platform].hint) }}</span>
      </label>
      <label v-if="form.platform === 'WHATSAPP'" class="field">
        {{ t('邀請連結') }}<input v-model="form.inviteUrl" class="input" placeholder="https://chat.whatsapp.com/…" required />
      </label>
      <label v-else class="field">
        {{ t('二維碼圖片（截圖即可）') }}
        <input type="file" accept="image/*" @change="(event) => pick(event, (url) => (form.qrImage = url))" />
        <img v-if="form.qrImage" :src="form.qrImage" alt="" class="group-invite__qr" />
      </label>
      <div class="row">
        <button class="button" type="submit" :disabled="busy || (form.platform !== 'WHATSAPP' && !form.qrImage)">{{ t('加入') }}</button>
        <button class="button secondary" type="button" @click="adding = false">{{ t('取消') }}</button>
      </div>
    </form>
    <button v-else-if="invites.length < 5" class="button secondary block" type="button" @click="adding = true"><AppIcon name="add" :size="18" />{{ t('加入派單群') }}</button>
  </section>
</template>

<style scoped>
.group-invites--none {
  padding-top: var(--space-sm);
  padding-bottom: var(--space-sm);
}
.group-invites__open {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  min-height: 52px;
  padding: var(--space-sm) 0;
  border: none;
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.group-invites__icon {
  flex: none;
  color: var(--color-primary);
}
.group-invites__text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.group-invites__text strong {
  font-weight: 600;
}
.group-invites__text small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.group-invites__arrow {
  color: var(--color-text-muted);
}
.group-invite {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-md) 0;
  border-bottom: 1px solid var(--color-divider);
}
.group-invite__qr {
  width: 72px;
  height: 72px;
  object-fit: contain;
  border-radius: var(--radius-input);
  background: var(--color-background);
}
.group-invite__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1;
  min-width: 0;
}
.group-invite__warn {
  color: #c03a3a;
  font-size: var(--font-caption);
}
.group-invite__form {
  margin-top: var(--space-md);
}
</style>
