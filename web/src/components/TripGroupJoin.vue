<script setup lang="ts">
import { copyText, inWeChat } from '../device';
import { t } from '../i18n';
import { toast } from '../toast';

export interface TripGroup {
  platform: 'WHATSAPP' | 'WECHAT';
  inviteUrl: string | null;
  qrUrl: string | null;
  expiresAt?: string | null;
  expired?: boolean;
}

/**
 * 行程群: the way into the group the dispatcher made for one trip (passenger, dispatcher, driver).
 * WhatsApp cannot be opened from inside WeChat, so there the link is copied.
 */
defineProps<{ group: TripGroup }>();

async function copyLink(url: string) {
  toast((await copyText(url)) ? '已複製連結，請在 WhatsApp 打開' : '複製失敗，請長按連結自行複製');
}
</script>

<template>
  <div class="trip-group">
    <template v-if="group.platform === 'WHATSAPP' && group.inviteUrl">
      <button v-if="inWeChat" class="button block" type="button" @click="copyLink(group.inviteUrl)">{{ t('複製 WhatsApp 群連結') }}</button>
      <a v-else class="button block" :href="group.inviteUrl" target="_blank" rel="noopener">{{ t('用 WhatsApp 加入行程群') }}</a>
    </template>
    <template v-else-if="group.qrUrl">
      <img :src="group.qrUrl" :alt="t('行程群二維碼')" class="trip-group__qr" />
      <span class="hint">{{ t('在微信長按識別二維碼加入群聊') }}</span>
    </template>
  </div>
</template>

<style scoped>
.trip-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  text-align: center;
}
.trip-group > .button {
  align-self: stretch;
}
.trip-group__qr {
  width: 220px;
  height: 220px;
  object-fit: contain;
  background: var(--color-surface);
}
</style>
