<script setup lang="ts">
import { computed } from 'vue';
import { copyText, inWeChat, whatsappChat } from '../device';
import { phonePlace } from '../format';
import { t } from '../i18n';
import { toast } from '../toast';
import BrandLogo from './BrandLogo.vue';

/**
 * How to reach someone: their numbers (港澳 and 內地, one for each side of the border), and the
 * WeChat ID and WhatsApp number from their 名片頁. A WhatsApp number that is one of the numbers
 * listed is not a line of its own: that number's line gets the WhatsApp mark beside 致電.
 * WhatsApp cannot be opened from inside WeChat, so there the number is copied.
 */
const props = defineProps<{ phones?: string[]; wechatId?: string | null; whatsapp?: string | null }>();

const digits = (number: string) => number.replace(/[^0-9]/g, '');
const onWhatsApp = (phone: string) => Boolean(props.whatsapp) && digits(phone) === digits(props.whatsapp as string);
/** WhatsApp on a number of its own, not one of the lines above. */
const otherWhatsApp = computed(() => (props.whatsapp && !(props.phones ?? []).some(onWhatsApp) ? props.whatsapp : null));

async function copy(text: string, done: string) {
  toast((await copyText(text)) ? done : '複製失敗，請長按文字自行複製');
}
</script>

<template>
  <div v-if="phones?.length || wechatId || whatsapp" class="contact-lines">
    <div v-for="phone in phones ?? []" :key="phone" class="contact-lines__line">
      <span class="contact-lines__text"><small>{{ t(phonePlace(phone)) }}</small>{{ phone }}</span>
      <span class="contact-lines__actions">
        <template v-if="onWhatsApp(phone)">
          <button v-if="inWeChat" class="contact-lines__app" type="button" :aria-label="t('複製 WhatsApp 號碼')" @click="copy(phone, '已複製號碼，到 WhatsApp 找這個號碼')">
            <BrandLogo name="whatsapp" :size="26" />
          </button>
          <a v-else class="contact-lines__app" :href="whatsappChat(phone)" target="_blank" rel="noopener" :aria-label="t('用 WhatsApp 聯絡')">
            <BrandLogo name="whatsapp" :size="26" />
          </a>
        </template>
        <a class="chip" :href="`tel:${phone.replace(/\s/g, '')}`">{{ t('致電') }}</a>
      </span>
    </div>
    <div v-if="wechatId" class="contact-lines__line">
      <span class="contact-lines__brand">
        <BrandLogo name="wechat" :label="t('微信')" />
        <span class="contact-lines__text"><small>{{ t('微信') }}</small>{{ wechatId }}</span>
      </span>
      <button class="chip" type="button" @click="copy(wechatId, '已複製微信號，到微信加好友')">{{ t('複製') }}</button>
    </div>
    <div v-if="otherWhatsApp" class="contact-lines__line">
      <span class="contact-lines__brand">
        <BrandLogo name="whatsapp" label="WhatsApp" />
        <span class="contact-lines__text"><small>WhatsApp</small>{{ otherWhatsApp }}</span>
      </span>
      <button v-if="inWeChat" class="chip" type="button" @click="copy(otherWhatsApp, '已複製號碼')">{{ t('複製') }}</button>
      <a v-else class="chip" :href="whatsappChat(otherWhatsApp)" target="_blank" rel="noopener">{{ t('打開') }}</a>
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
.contact-lines__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}
.contact-lines__text small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.contact-lines__brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.contact-lines__actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: none;
}
/* The WhatsApp mark as a button: large enough to tap. */
.contact-lines__app {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}
</style>
