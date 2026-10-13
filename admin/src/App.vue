<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ROLE_LABEL, session, type AdminRole } from './api';

const route = useRoute();
const router = useRouter();

const NAV: { to: string; label: string; roles?: AdminRole[] }[] = [
  { to: '/', label: '總覽' },
  { to: '/users', label: '用戶' },
  { to: '/orders', label: '訂單' },
  { to: '/billing', label: '收費控制', roles: ['SUPER_ADMIN', 'OPERATOR'] },
  { to: '/service-fee', label: '平台服務費', roles: ['SUPER_ADMIN', 'OPERATOR'] },
  { to: '/settings/development-login', label: '登入配置', roles: ['SUPER_ADMIN', 'OPERATOR'] },
  { to: '/accounts', label: '後台帳號', roles: ['SUPER_ADMIN'] },
  { to: '/audit', label: '操作紀錄', roles: ['SUPER_ADMIN'] },
];

const nav = computed(() => NAV.filter((item) => !item.roles || (session.admin && item.roles.includes(session.admin.role))));
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));

async function logout() {
  await api('POST', '/auth/logout').catch(() => undefined);
  session.admin = null;
  await router.push('/login');
}
</script>

<template>
  <div v-if="session.admin && !route.meta.public" class="admin-shell">
    <aside class="admin-shell__side">
      <div class="admin-shell__brand">
        <strong>MasterDriver</strong>
        <span>跨境師傅幫｜平台後台</span>
      </div>
      <nav class="admin-shell__nav">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" :class="{ active: isActive(item.to) }">
          {{ item.label }}
        </RouterLink>
      </nav>
      <div class="admin-shell__me">
        <div>{{ session.admin.displayName }}</div>
        <div class="hint">{{ ROLE_LABEL[session.admin.role] }}</div>
        <div class="row">
          <RouterLink to="/password" class="hint">修改密碼</RouterLink>
          <a href="#" class="hint" @click.prevent="logout">登出</a>
        </div>
      </div>
    </aside>
    <main class="admin-shell__main">
      <RouterView :key="route.fullPath" />
    </main>
  </div>
  <RouterView v-else />
</template>

<style scoped>
.admin-shell {
  display: flex;
  min-height: 100vh;
}

.admin-shell__side {
  width: 220px;
  flex-shrink: 0;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: var(--space-xl) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.admin-shell__brand {
  display: flex;
  flex-direction: column;
}

.admin-shell__brand span {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}

.admin-shell__nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1;
}

.admin-shell__nav a {
  color: var(--color-nav-inactive);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
}

.admin-shell__nav a.active {
  color: var(--color-nav-active);
  background: var(--color-tint);
  font-weight: 600;
}

.admin-shell__main {
  flex: 1;
  min-width: 0;
  padding: var(--space-xl);
  max-width: 1200px;
}

@media (max-width: 760px) {
  .admin-shell {
    flex-direction: column;
  }

  .admin-shell__side {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    gap: var(--space-md);
  }

  .admin-shell__nav {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .admin-shell__main {
    padding: var(--space-lg);
  }
}
</style>
