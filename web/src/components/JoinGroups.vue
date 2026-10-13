<script setup lang="ts">
import { ref } from 'vue';
import { copyText, inWeChat } from '../device';
import { t } from '../i18n';
import { toast } from '../toast';

export interface OfferedGroup {
  id: string;
  platform: 'WECHAT' | 'WHATSAPP' | 'WECHAT_CONTACT';
  name: string;
  inviteUrl: string | null;
  qrUrl: string | null;
}

/**
 * The dispatcher's groups on a claim page. Folded behind one tap so the page
 * does not read as a QR-code flyer (WeChat is strict about pages spreading QR codes).
 */
defineProps<{ groups: OfferedGroup[]; dispatcherName: string | null }>();

/** Groups added since the name stopped being asked are titled by their type. */
const TITLE: Record<OfferedGroup['platform'], string> = { WECHAT: '微信群', WECHAT_CONTACT: '加微信，拉你入群', WHATSAPP: 'WhatsApp 群' };
const title = (group: OfferedGroup) => group.name || TITLE[group.platform];
const open = ref(false);

async function copyLink(url: string) {
  toast((await copyText(url)) ? '已複製連結，請在 WhatsApp 打開' : '複製失敗，請長按連結自行複製');
}
</script>

<template>
  <section v-if="groups.length" class="card">
    <button class="button secondary block" type="button" @click="open = !open">
      {{ t(`加入 ${dispatcherName ?? '出單者'} 的派單群`) }}
    </button>
    <div v-if="open" class="join-groups">
      <div v-for="group in groups" :key="group.id" class="join-groups__item">
        <strong>{{ t(title(group)) }}</strong>
        <template v-if="group.platform === 'WHATSAPP' && group.inviteUrl">
          <button v-if="inWeChat" class="button block" type="button" @click="copyLink(group.inviteUrl)">{{ t('複製 WhatsApp 群連結') }}</button>
          <a v-else class="button block" :href="group.inviteUrl" target="_blank" rel="noopener">{{ t('用 WhatsApp 加入') }}</a>
        </template>
        <template v-else-if="group.qrUrl">
          <img :src="group.qrUrl" :alt="t(title(group))" class="join-groups__qr" />
          <span class="hint">
            {{ group.platform === 'WECHAT_CONTACT' ? t('長按識別二維碼加好友，對方會拉你入群') : t('長按識別二維碼加入群聊') }}
          </span>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.join-groups {
  margin-top: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.join-groups__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  text-align: center;
}
.join-groups__qr {
  width: 220px;
  height: 220px;
  object-fit: contain;
  background: var(--color-surface);
}
</style>
