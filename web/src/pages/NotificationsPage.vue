<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import PageBack from '../components/PageBack.vue';
import { shortTime } from '../format';
import { t } from '../i18n';
import { describe, inbox, markAllRead, markRead, refreshInbox, type NotificationItem } from '../notifications';

/**
 * 通知: what happened to the driver's orders, bookings and 客服 conversation, newest first.
 * Unread lines are bold with 新; opening one reads it and goes to what it is about.
 */
const router = useRouter();

async function open(item: NotificationItem) {
  void markRead(item);
  const to = describe(item).to;
  if (to) await router.push(to);
}

onMounted(() => void refreshInbox());
</script>

<template>
  <div class="page">
    <PageBack :title="t('通知')">
      <button v-if="inbox.unread" class="chip" type="button" @click="markAllRead">{{ t('全部已讀') }}</button>
    </PageBack>

    <p v-if="inbox.loaded && inbox.items.length === 0" class="notices__empty">
      {{ t('還沒有通知。有人接了你出的單、乘客確認行程、名片頁有新預約、客服回覆你時，會在這裡出現。') }}
    </p>

    <section v-if="inbox.items.length" class="card notices">
      <button
        v-for="item in inbox.items"
        :key="item.id"
        type="button"
        class="notices__line"
        :class="{ 'notices__line--unread': !item.read }"
        @click="open(item)"
      >
        <span class="notices__top">
          <span class="notices__title">{{ t(describe(item).title) }}</span>
          <span v-if="!item.read" class="notices__new">{{ t('新') }}</span>
          <span class="notices__when">{{ shortTime(item.createdAt) }}</span>
        </span>
        <span v-if="describe(item).detail" class="notices__detail">{{ t(describe(item).detail) }}</span>
      </button>
    </section>

    <RouterLink to="/app/notification-settings" class="notices__settings">{{ t('通知設定：提示音、要收哪些通知') }}</RouterLink>
  </div>
</template>

<style scoped>
.notices {
  padding-top: 0;
  padding-bottom: 0;
}
.notices__line {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
  padding: var(--space-md) 0;
  border: none;
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.notices__line + .notices__line {
  border-top: 1px solid var(--color-border);
}
.notices__top {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.notices__title {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
}
.notices__line--unread .notices__title {
  color: var(--color-text);
  font-weight: 700;
}
.notices__new {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--color-error);
  color: var(--color-on-primary);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
}
.notices__when {
  flex-shrink: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-variant-numeric: tabular-nums;
}
.notices__detail {
  color: var(--color-text-secondary);
  font-size: var(--font-label);
  overflow-wrap: anywhere;
}
.notices__empty {
  color: var(--color-text-secondary);
  line-height: 1.7;
}
.notices__settings {
  display: block;
  margin-top: var(--space-lg);
  color: var(--color-primary-dark);
  font-weight: 600;
}
</style>
