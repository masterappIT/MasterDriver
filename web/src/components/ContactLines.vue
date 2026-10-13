<script setup lang="ts">
import { copyText, inWeChat, whatsappChat } from '../device';
import { t } from '../i18n';
import { toast } from '../toast';

/**
 * How to reach someone on an order beyond their first number: their other numbers (港澳 or 內地,
 * for the other side of the border), and the WeChat ID and WhatsApp number from their 名片頁.
 * WhatsApp cannot be opened from inside WeChat, so there the number is copied.
 */
defineProps<{ phones?: string[]; wechatId?: string | null; whatsapp?: string | null }>();

const PLACES: Record<string, string> = { '+852': '香港號碼', '+853': '澳門號碼', '+86': '內地號碼' };
const placeOf = (phone: string) => PLACES[phone.split(' ')[0]] ?? '電話';

async function copy(text: string, done: string) {
  toast((await copyText(text)) ? done : '複製失敗，請長按文字自行複製');
}
</script>

<template>
  <div v-if="phones?.length || wechatId || whatsapp" class="contact-lines">
    <div v-for="phone in phones ?? []" :key="phone" class="contact-lines__line">
      <span><small>{{ t(placeOf(phone)) }}</small>{{ phone }}</span>
      <a class="chip" :href="`tel:${phone.replace(/\s/g, '')}`">{{ t('致電') }}</a>
    </div>
    <div v-if="wechatId" class="contact-lines__line">
      <span><small>{{ t('微信') }}</small>{{ wechatId }}</span>
      <button class="chip" type="button" @click="copy(wechatId, '已複製微信號，到微信加好友')">{{ t('複製') }}</button>
    </div>
    <div v-if="whatsapp" class="contact-lines__line">
      <span><small>WhatsApp</small>{{ whatsapp }}</span>
      <button v-if="inWeChat" class="chip" type="button" @click="copy(whatsapp, '已複製號碼')">{{ t('複製') }}</button>
      <a v-else class="chip" :href="whatsappChat(whatsapp)" target="_blank" rel="noopener">{{ t('打開') }}</a>
    </div>
  </div>
</template>

<style scoped>
.contact-lines__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  border-top: 1px solid var(--color-divider);
}
.contact-lines__line > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}
.contact-lines__line small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
</style>
