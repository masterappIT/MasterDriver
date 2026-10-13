<script setup lang="ts">
import { t } from '../i18n';
import { inbox } from '../notifications';
import AppIcon from './AppIcon.vue';

/** The bell at the top of 首頁 and 我的: how many notifications are unread, and the way to them. */
</script>

<template>
  <RouterLink to="/app/notifications" class="bell" :aria-label="inbox.unread ? t(`通知，${inbox.unread} 則未讀`) : t('通知')">
    <AppIcon name="bell" :size="22" />
    <span v-if="inbox.unread" class="bell__count">{{ inbox.unread > 99 ? '99+' : inbox.unread }}</span>
  </RouterLink>
</template>

<style scoped>
.bell {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-tint);
  color: var(--color-primary-dark);
}
.bell__count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border: 2px solid var(--color-surface);
  border-radius: var(--radius-pill);
  background: var(--color-error);
  color: var(--color-on-primary);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}
</style>
