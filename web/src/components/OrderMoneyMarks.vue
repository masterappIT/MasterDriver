<script setup lang="ts">
import { shortTime } from '../format';
import { t } from '../i18n';

/**
 * 收款與結清: the dispatcher's own marks on an order. 已收款 and the ways to pay on the passenger's
 * page are the dispatcher's; 已結清 both sides see, and only the dispatcher sets. The platform
 * takes no money and checks nothing.
 */
defineProps<{
  order: { status: string; paidAt?: string | null; settledAt?: string | null; showPaymentMethods?: boolean; journey: unknown; carpool?: unknown };
  isDispatcher: boolean;
  canSettle: boolean;
  busy: boolean;
}>();
defineEmits<{ payment: [body: { showPaymentMethods?: boolean; paid?: boolean }, done: string]; settled: [settled: boolean] }>();
</script>

<template>
  <!-- 收款: the dispatcher's own mark, after checking their account. -->
  <!-- 拼車: each party pays on its own; marked in 拼車乘客, and the ways to pay are set on the carpool. -->
  <p v-if="isDispatcher && order.carpool && order.status !== 'CANCELLED'" class="hint detail__divided">{{ t('拼車每組各自付款：在「拼車乘客」逐組標記已收款；收款方式在拼車頁開關。') }}</p>
  <div v-if="isDispatcher && !order.carpool && order.status !== 'CANCELLED'" class="detail__paid detail__divided">
    <span class="detail__paid-state" :class="{ 'detail__paid-state--yes': order.paidAt }">
      {{ order.paidAt ? t(`${shortTime(order.paidAt)} 已收款`) : t('未收款') }}
    </span>
    <button class="chip" type="button" :disabled="busy" @click="$emit('payment', { paid: !order.paidAt }, order.paidAt ? '已改回未收款' : '已記為已收款')">
      {{ order.paidAt ? t('改回未收款') : t('標記已收款') }}
    </button>
  </div>
  <label v-if="isDispatcher && !order.carpool && order.status !== 'CANCELLED'" class="detail__switch detail__divided">
    <span>
      {{ t('乘客確認頁顯示收款方式') }}
      <small>{{ order.journey ? t('整張接駁單一起顯示，乘客付一次') : t('顯示時會一併顯示乘客價') }}</small>
    </span>
    <input
      class="switch"
      type="checkbox"
      :checked="order.showPaymentMethods"
      :disabled="busy"
      @change="$emit('payment', { showPaymentMethods: !order.showPaymentMethods }, '已更新')"
    />
  </label>
  <!-- 已結清: the dispatcher's own mark; the driver sees it. No amount, and the platform does not check it. -->
  <div v-if="canSettle" class="detail__paid detail__divided">
    <span class="detail__settle">
      <span class="detail__paid-state" :class="{ 'detail__paid-state--yes': order.settledAt }">
        {{ order.settledAt ? t(`${shortTime(order.settledAt)} 已結清`) : t('未結清') }}
      </span>
      <small>{{ isDispatcher ? t('和接單司機的帳，你們自己結，平台不經手') : t('和出單者的帳，由出單者標記，平台不經手') }}</small>
    </span>
    <button v-if="isDispatcher" class="chip" type="button" :disabled="busy" @click="$emit('settled', !order.settledAt)">
      {{ order.settledAt ? t('改回未結清') : t('標記已結清') }}
    </button>
  </div>
</template>

<style scoped>
/* The same rows as on the order page around it. */
.detail__paid,
.detail__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.detail__switch {
  font-weight: 600;
}
.detail__switch > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.detail__switch small,
.detail__settle small {
  display: block;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
.detail__divided {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-divider);
}
.detail__settle {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.detail__paid-state {
  color: var(--color-gold-ink);
  font-weight: 700;
}
.detail__paid-state--yes {
  color: var(--status-confirmed);
}
</style>
