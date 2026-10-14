<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorText } from '../api';
import AppIcon from '../components/AppIcon.vue';
import BottomSheet from '../components/BottomSheet.vue';
import GroupText from '../components/GroupText.vue';
import { copyText, inWeChat, whatsappLink } from '../device';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import type { Journey } from '../journey';
import { toast } from '../toast';

interface Sent {
  id: string;
  status: string;
  viewer: 'dispatcher' | 'driver';
  selfDrive?: boolean;
  claimedAt: string | null;
  passengerConfirmedAt: string | null;
  journey: Journey | null;
  /** The dispatcher's own WeChat ID and WhatsApp, as the driver who takes the order will see them. */
  dispatcherContact?: { wechatId: string | null; whatsapp: string | null };
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

/** 這單我自己做 on a 直達 order: nothing to paste. A 接駁 order always has a leg for the group. */
const selfDriven = computed(() => Boolean(order.value?.selfDrive && !order.value.journey));
/** 接駁: someone holds each leg, the dispatcher or a driver. */
const bothTaken = computed(() => Boolean(order.value?.journey?.legs.every((leg) => leg.status !== 'OPEN')));

/**
 * The driver who takes the order reaches the dispatcher by phone, and by WeChat or WhatsApp when
 * the dispatcher gave them. With neither, say so once in a sheet; after that a line on the page.
 */
const ASKED_KEY = 'md.contactAsked';
const noContact = computed(() => {
  const o = order.value;
  return Boolean(o && o.viewer === 'dispatcher' && !selfDriven.value && o.dispatcherContact && !o.dispatcherContact.wechatId && !o.dispatcherContact.whatsapp);
});
const askContact = ref(false);

function closeAsk() {
  askContact.value = false;
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* private mode: the sheet shows again next time */
  }
}

async function copy(text: string | undefined, done: string) {
  if (!text) return;
  toast((await copyText(t(text))) ? done : '複製失敗，請長按文字自行複製');
}

onMounted(async () => {
  try {
    order.value = await api<Sent>('GET', `/orders/${id}`);
    let asked = false;
    try {
      asked = localStorage.getItem(ASKED_KEY) === '1';
    } catch {
      /* ask */
    }
    askContact.value = noContact.value && !asked;
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page share">
    <PageBack fallback="/app/orders?tab=dispatched" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="order && order.share">
      <header class="share__head">
        <strong>{{ t('已出單') }}</strong>
        <span v-if="selfDriven">{{ t('這單你自己做，不用貼到群裡') }}</span>
      </header>

      <ol class="share__steps" :aria-label="t('進度')">
        <li class="done">{{ t('已出單') }}</li>
        <li :class="{ done: order.journey ? bothTaken : order.claimedAt }">{{ selfDriven ? t('你自己做') : order.journey ? t('兩段都有人接') : t('有人接') }}</li>
        <li :class="{ done: order.passengerConfirmedAt }">{{ t('乘客確認') }}</li>
      </ol>

      <section v-if="!selfDriven" class="card">
        <!-- How it works, in three short steps, for someone dispatching for the first time. -->
        <ol class="share__how">
          <li><span>1</span>{{ t('複製') }}</li>
          <li><span>2</span>{{ t('到群裡長按貼上') }}</li>
          <li><span>3</span>{{ order.journey ? t('司機點連結選段搶') : t('司機點連結搶單') }}</li>
        </ol>
        <GroupText :text="order.share.dispatch.wechat" :link-note="t('藍色是這張單的搶單連結，會和文字一起複製')" />
        <div class="share__buttons" :class="{ 'share__buttons--whatsapp-first': !inWeChat }">
          <button class="button" :class="{ outline: !inWeChat }" type="button" @click="copy(order.share.dispatch.wechat, '已複製，回到微信群長按輸入框貼上')">
            <AppIcon name="copy" :size="18" />{{ t('複製到微信群') }}
          </button>
          <button class="button" :class="{ outline: inWeChat }" type="button" @click="copy(order.share.dispatch.whatsapp, '已複製，回到 WhatsApp 群長按輸入框貼上')">
            <AppIcon name="copy" :size="18" />{{ t('複製到 WhatsApp') }}
          </button>
        </div>
        <!-- WhatsApp cannot be opened from inside WeChat, so the link only shows elsewhere. -->
        <a v-if="!inWeChat" class="share__wa" :href="whatsappLink(t(order.share.dispatch.whatsapp))" target="_blank" rel="noopener">
          {{ t('直接用 WhatsApp 傳送') }}
        </a>
      </section>

      <section class="card">
        <h2 class="share__label">{{ t('傳給乘客確認') }}</h2>
        <p class="share__passenger-hint">
          {{ order.journey ? t('乘客按連結確認行程，只會知道是接駁、要換車，不會看到接駁位置；兩段有司機後，乘客會看到兩位司機和車牌。') : t('乘客按連結確認行程；有司機接單後，乘客會看到司機和車牌。') }}
        </p>
        <GroupText :text="order.share.passenger" />
        <button class="button outline block" type="button" @click="copy(order.share.passenger, '已複製，傳給乘客吧')">
          <AppIcon name="copy" :size="18" />{{ t('複製給乘客') }}
        </button>
      </section>

      <p v-if="noContact" class="hint share__hint">
        {{ t('你還沒填微信號或 WhatsApp，接單司機只能打電話找你。') }}<RouterLink to="/app/profile-page">{{ t('去填寫') }}</RouterLink>
      </p>

      <div class="share__next">
        <RouterLink class="button secondary" :to="`/app/orders/${order.id}`">{{ t('查看這張單') }}</RouterLink>
      </div>
    </template>

    <BottomSheet v-if="askContact" :title="t('讓接單司機找得到你')" @close="closeAsk">
      <p class="share__ask">{{ t('你還沒填微信號或 WhatsApp。有人接單後，對方現在只看得到你的電話。填了之後，接單司機可以直接加你微信或開 WhatsApp。') }}</p>
      <p class="hint">{{ t('只有接了你的單的司機看得到，不用公開名片頁。') }}</p>
      <div class="share__ask-buttons">
        <button class="button secondary" type="button" @click="closeAsk">{{ t('之後再說') }}</button>
        <RouterLink class="button" to="/app/profile-page" @click="closeAsk">{{ t('去填寫') }}</RouterLink>
      </div>
    </BottomSheet>

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
/* 1 複製 · 2 到群裡長按貼上 · 3 司機點連結搶單: one short row, numbers in small circles. */
.share__how {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-xs) var(--space-sm);
  margin: 0 0 var(--space-md);
  padding: 0;
  list-style: none;
  color: var(--color-label);
  font-size: var(--font-caption);
  line-height: 1.4;
}
.share__how li {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.share__how span {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: 13px;
  font-weight: 700;
}
.share__passenger-hint {
  margin: 0 0 var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.share__buttons {
  display: grid;
  gap: var(--space-sm);
}
.share__buttons--whatsapp-first > :first-child {
  order: 1;
}
.share__ask {
  margin: 0 0 var(--space-sm);
}
.share__ask-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
  margin-top: var(--space-md);
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
