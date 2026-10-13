<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import AppIcon from '../components/AppIcon.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { MAX_JOURNEY_LEGS, type Journey } from '../journey';
import { toast } from '../toast';

interface Sent {
  id: string;
  status: string;
  viewer: 'dispatcher' | 'driver';
  selfDrive?: boolean;
  claimedAt: string | null;
  passengerConfirmedAt: string | null;
  journey: Journey | null;
  share?: { dispatch: { wechat: string; whatsapp: string }; claimed: string | null; passenger: string };
}

/**
 * Right after 出單: the texts that carry the order into the groups and to the passenger.
 * This is where the tool does its work, so the text to paste comes first, shown as it will look.
 */
const route = useRoute();
const id = String(route.params.id);
const order = ref<Sent | null>(null);
const error = ref('');

const selfDriven = computed(() => Boolean(order.value?.selfDrive));
const live = computed(() => order.value?.status === 'OPEN' || order.value?.status === 'ASSIGNED');
/** 接駁: another leg can follow the last leg of a trip, up to the limit. */
const canAddLeg = computed(() => {
  const o = order.value;
  if (!o || o.viewer !== 'dispatcher' || !live.value) return false;
  return !o.journey || (o.journey.legIndex === o.journey.legCount && o.journey.legCount < MAX_JOURNEY_LEGS);
});

async function copy(text: string | undefined, done: string) {
  if (!text) return;
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

onMounted(async () => {
  try {
    order.value = await api<Sent>('GET', `/orders/${id}`);
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page share">
    <PageBack fallback="/app" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="order && order.share">
      <header class="share__head">
        <strong>{{ t('已出單') }}</strong>
        <span v-if="!selfDriven">{{ t('把下面的文字貼到群裡，司機點連結就能搶') }}</span>
        <span v-else>{{ t('這段你自己做，不用貼到群裡') }}</span>
      </header>

      <ol class="share__steps" :aria-label="t('進度')">
        <li class="done">{{ t('已出單') }}</li>
        <li :class="{ done: order.claimedAt }">{{ selfDriven ? t('你自己做') : t('有人接') }}</li>
        <li :class="{ done: order.passengerConfirmedAt }">{{ t('乘客確認') }}</li>
      </ol>

      <section v-if="!selfDriven" class="card">
        <h2 class="share__label">{{ t('貼到群裡') }}</h2>
        <pre class="share__text">{{ t(order.share.dispatch.wechat) }}</pre>
        <div class="share__buttons">
          <button class="button" type="button" @click="copy(order.share.dispatch.wechat, '已複製，貼到微信群吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製到微信群') }}
          </button>
          <button class="button" type="button" @click="copy(order.share.dispatch.whatsapp, '已複製，貼到 WhatsApp 群吧')">
            <AppIcon name="copy" :size="18" />{{ t('複製到 WhatsApp') }}
          </button>
        </div>
        <!-- WhatsApp cannot be opened from inside WeChat, so the link only shows elsewhere. -->
        <a v-if="!inWeChat" class="share__wa" :href="whatsappLink(t(order.share.dispatch.whatsapp))" target="_blank" rel="noopener">
          {{ t('直接用 WhatsApp 傳送') }}
        </a>
      </section>

      <section class="card">
        <h2 class="share__label">{{ t('傳給乘客的確認連結') }}</h2>
        <pre class="share__text">{{ t(order.share.passenger) }}</pre>
        <button class="button secondary block" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
          <AppIcon name="copy" :size="18" />{{ t('複製給乘客') }}
        </button>
      </section>

      <div class="share__next">
        <RouterLink v-if="canAddLeg" class="button secondary" :to="`/app/new?after=${order.id}`"><AppIcon name="add" :size="18" />{{ t('加接駁段') }}</RouterLink>
        <RouterLink class="button secondary" :to="`/app/orders/${order.id}`">{{ t('查看這張單') }}</RouterLink>
      </div>
      <p v-if="order.journey?.legCount === 1" class="hint share__hint">{{ t('這是接駁單的第 1 段，接著按「加接駁段」發下一段。') }}</p>
    </template>

    <!-- Someone other than the dispatcher opened this address: send them to the order itself. -->
    <section v-else-if="order" class="card">
      <RouterLink class="button block" :to="`/app/orders/${order.id}`">{{ t('查看這張單') }}</RouterLink>
    </section>
  </div>
</template>

<style scoped>
.share__head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  margin: var(--space-sm) 0 var(--space-md);
  text-align: center;
}
.share__head strong {
  font-size: 22px;
}
.share__head span {
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
/* 已出單, 有人接, 乘客確認: the three things a dispatcher waits for. */
.share__steps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-xs);
  margin: 0 0 var(--space-lg);
  padding: 0;
  text-align: center;
  font-size: var(--font-caption);
  color: var(--color-text-muted);
}
.share__steps li {
  padding-top: var(--space-sm);
  border-top: 3px solid var(--color-border);
}
.share__steps li.done {
  border-top-color: var(--color-teal);
  color: var(--color-text);
  font-weight: 700;
}
.share__label {
  margin: 0 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 600;
}
/* The text exactly as it will be pasted. */
.share__text {
  margin: 0 0 var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-background);
  font: inherit;
  font-size: var(--font-label);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.share__buttons {
  display: grid;
  gap: var(--space-sm);
}
.share__wa {
  display: block;
  margin-top: var(--space-md);
  text-align: center;
  font-size: var(--font-label);
}
.share__next {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: var(--space-sm);
}
.share__hint {
  margin-top: var(--space-md);
  text-align: center;
}
</style>
