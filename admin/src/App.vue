<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ROLE_LABEL, session, type AdminRole } from './api';

const route = useRoute();
const router = useRouter();

interface NavLink {
  to: string;
  label: string;
  roles?: AdminRole[];
}
interface NavGroup {
  label: string;
  items: NavLink[];
}

const WRITE: AdminRole[] = ['SUPER_ADMIN', 'OPERATOR'];

// Order and grouping follow the Master Travel admin: operations first, then settings, support, accounts and logs.
const NAV: (NavLink | NavGroup)[] = [
  { to: '/', label: '總覽' },
  { to: '/observability', label: '數據流監控', roles: WRITE },
  { to: '/users', label: '用戶' },
  { to: '/orders', label: '訂單' },
  { to: '/leads', label: '潛在客戶' },
  { to: '/billing', label: '收費控制', roles: WRITE },
  { to: '/ads', label: '廣告欄位', roles: WRITE },
  { to: '/payment-channels', label: '付款通道', roles: WRITE },
  { to: '/service-fee', label: '平台服務費', roles: WRITE },
  { to: '/settings/login', label: '登入配置', roles: WRITE },
  { to: '/settings/general', label: '一般設定', roles: WRITE },
  { to: '/seo', label: 'SEO', roles: WRITE },
  { to: '/settings/limits', label: '防濫用設定', roles: WRITE },
  { to: '/support', label: '客服', roles: WRITE },
  { to: '/accounts', label: '後台帳號', roles: ['SUPER_ADMIN'] },
  { to: '/audit', label: '操作紀錄', roles: ['SUPER_ADMIN'] },
];

const allowed = (item: NavLink) => !item.roles || (session.admin && item.roles.includes(session.admin.role));
const nav = computed(() =>
  NAV.map((entry) => ('items' in entry ? { ...entry, items: entry.items.filter(allowed) } : entry)).filter((entry) =>
    'items' in entry ? entry.items.length > 0 : allowed(entry),
  ),
);
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`));

const mobileNavOpen = ref(false);
watch(
  () => route.path,
  () => {
    mobileNavOpen.value = false;
  },
);

async function logout() {
  await api('POST', '/auth/logout').catch(() => undefined);
  session.admin = null;
  await router.push('/login');
}
</script>

<template>
  <div v-if="session.admin && !route.meta.public" class="admin-shell">
    <aside class="admin-shell__side" :class="{ 'admin-shell__side--open': mobileNavOpen }">
      <div class="admin-shell__brand">
        <strong>MasterDriver</strong>
        <span>跨境師傅幫｜平台後台</span>
      </div>
      <button
        type="button"
        class="admin-shell__toggle"
        :aria-expanded="mobileNavOpen ? 'true' : 'false'"
        aria-controls="admin-navigation"
        :aria-label="mobileNavOpen ? '關閉選單' : '開啟選單'"
        @click="mobileNavOpen = !mobileNavOpen"
      >
        <span aria-hidden="true"></span>
      </button>
      <nav id="admin-navigation" class="admin-shell__nav">
        <template v-for="entry in nav" :key="entry.label">
          <div v-if="'items' in entry" class="admin-shell__group">
            <div class="admin-shell__group-label">{{ entry.label }}</div>
            <div class="admin-shell__group-items">
              <RouterLink v-for="item in entry.items" :key="item.to" :to="item.to" :class="{ active: isActive(item.to) }">
                {{ item.label }}
              </RouterLink>
            </div>
          </div>
          <RouterLink v-else :to="entry.to" :class="{ active: isActive(entry.to) }">{{ entry.label }}</RouterLink>
        </template>
        <RouterLink to="/password" class="admin-shell__mobile-only" :class="{ active: isActive('/password') }">修改密碼</RouterLink>
        <button type="button" class="admin-shell__mobile-only" @click="logout">登出</button>
      </nav>
      <div class="admin-shell__me">
        <b>{{ session.admin.displayName }}</b>
        <span>{{ ROLE_LABEL[session.admin.role] }}</span>
      </div>
      <div class="admin-shell__account">
        <RouterLink to="/password" :class="{ active: isActive('/password') }">修改密碼</RouterLink>
        <button type="button" @click="logout">登出</button>
      </div>
    </aside>
    <main class="admin-shell__main">
      <span class="eyebrow admin-shell__eyebrow">管理控制台</span>
      <!-- 客服 keeps its inbox while switching conversations; every other page reloads with its URL. -->
      <RouterView :key="route.path.startsWith('/support') ? '/support' : route.fullPath" />
    </main>
  </div>
  <RouterView v-else />
</template>

<style scoped>
.admin-shell {
  display: flex;
  min-height: 100vh;
  background: radial-gradient(circle at 85% 0%, #dfeaff 0, transparent 32rem), var(--color-background);
}

.admin-shell__side {
  position: sticky;
  top: 0;
  display: flex;
  flex: 0 0 252px;
  flex-direction: column;
  width: 252px;
  height: 100vh;
  padding: 32px 20px 24px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  color: #fff;
  background: var(--gradient-side);
  box-shadow: 10px 0 35px rgba(18, 36, 59, 0.12);
}

/* The decorative rings on the side panel. */
.admin-shell__side::after {
  content: '';
  position: absolute;
  top: 110px;
  right: -100px;
  width: 220px;
  height: 220px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  box-shadow: 0 0 0 28px rgba(255, 255, 255, 0.035), 0 0 0 58px rgba(255, 255, 255, 0.025);
  pointer-events: none;
}

.admin-shell__brand {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 56px;
}

.admin-shell__brand strong {
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -0.03em;
}

.admin-shell__brand span {
  color: var(--color-nav-inactive);
  font-size: var(--font-caption);
}

.admin-shell__toggle {
  display: none;
}

.admin-shell__nav {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 8px;
  margin-top: 24px;
}

.admin-shell__nav a,
.admin-shell__nav button,
.admin-shell__account a,
.admin-shell__account button {
  display: block;
  width: 100%;
  padding: 14px 15px;
  border: 1px solid transparent;
  border-radius: 13px;
  color: var(--color-nav-inactive);
  background: transparent;
  font-size: 14px;
  text-align: left;
  text-decoration: none;
  transition: 0.2s ease;
}

.admin-shell__nav a:hover,
.admin-shell__nav button:hover,
.admin-shell__account a:hover,
.admin-shell__account button:hover {
  color: #fff;
  background: var(--color-nav-hover-bg);
}

.admin-shell__nav a.active,
.admin-shell__account a.active {
  border-color: rgba(255, 255, 255, 0.18);
  color: var(--color-nav-active);
  background: var(--color-nav-active-bg);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
}

.admin-shell__group {
  margin: 4px 0;
}

.admin-shell__group-label {
  padding: 14px 15px 4px;
  color: #dce8f7;
  font-size: 14px;
}

.admin-shell__group-items {
  display: grid;
  gap: 2px;
  margin: 3px 0 6px 14px;
}

.admin-shell__group-items a {
  padding: 9px 12px;
  color: var(--color-nav-sub);
  font-size: 12px;
}

.admin-shell__mobile-only {
  display: none !important;
}

.admin-shell__me {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 2px;
  margin-top: auto;
  padding: 24px 15px 12px;
  font-size: 12px;
}

.admin-shell__me span {
  color: var(--color-nav-inactive);
  font-size: 10px;
}

.admin-shell__account {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 2px;
}

.admin-shell__main {
  flex: 1 1 auto;
  width: min(100%, var(--admin-content-max-width));
  min-width: 0;
  padding: 56px clamp(24px, 5vw, 64px);
}

.admin-shell__eyebrow {
  margin-bottom: 8px;
}

@media (max-width: 1100px) {
  .admin-shell__side {
    flex-basis: 220px;
    width: 220px;
    padding-inline: 16px;
  }

  .admin-shell__main {
    padding: 36px 28px;
  }
}

@media (max-width: 700px) {
  .admin-shell {
    flex-direction: column;
  }

  .admin-shell__side {
    position: sticky;
    z-index: 20;
    flex: 0 0 auto;
    width: 100%;
    height: auto;
    padding: max(11px, env(safe-area-inset-top)) 14px 11px;
    overflow: visible;
  }

  .admin-shell__side::after,
  .admin-shell__account {
    display: none;
  }

  .admin-shell__side--open {
    box-shadow: 0 12px 28px rgb(15 23 42 / 14%);
  }

  .admin-shell__brand {
    min-height: 46px;
    padding-right: 64px;
  }

  .admin-shell__brand strong {
    font-size: 15px;
  }

  .admin-shell__toggle {
    position: absolute;
    z-index: 22;
    top: calc(max(11px, env(safe-area-inset-top)) + 23px);
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    transform: translateY(-50%);
    border: 2px solid rgb(255 255 255 / 62%);
    border-radius: 11px;
    color: #fff;
    background: linear-gradient(145deg, #2a78df, #1769d5);
    box-shadow: 0 0 0 3px rgb(42 120 223 / 24%), 0 5px 12px rgb(7 25 52 / 26%);
  }

  /* Three bars drawn with one span. */
  .admin-shell__toggle span {
    position: relative;
    display: block;
    width: 18px;
    height: 14px;
  }

  .admin-shell__toggle span::before {
    content: '';
    position: absolute;
    top: 1px;
    left: 0;
    width: 18px;
    height: 2px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 5px 0 currentColor, 0 10px 0 currentColor;
  }

  .admin-shell__me {
    position: absolute;
    top: calc(max(11px, env(safe-area-inset-top)) + 23px);
    right: 60px;
    display: block;
    max-width: min(38vw, 140px);
    margin: 0;
    padding: 3px 5px;
    overflow: hidden;
    transform: translateY(-50%);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .admin-shell__me span {
    display: none;
  }

  .admin-shell__nav {
    display: none;
  }

  .admin-shell__side--open .admin-shell__nav {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 10px;
    padding: 2px 0 4px;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .admin-shell__side--open .admin-shell__nav::-webkit-scrollbar {
    display: none;
  }

  .admin-shell__nav a,
  .admin-shell__nav button {
    flex: 0 0 auto;
    width: auto;
    padding: 7px 10px;
    border-radius: 8px;
    font-size: 12px;
    text-align: center;
    white-space: nowrap;
  }

  .admin-shell__group,
  .admin-shell__group-items {
    display: contents;
  }

  .admin-shell__group-label {
    display: none;
  }

  .admin-shell__group-items a {
    padding: 7px 10px;
    color: var(--color-nav-inactive);
  }

  .admin-shell__mobile-only {
    display: block !important;
  }

  .admin-shell__main {
    width: 100%;
    padding: 24px 16px 40px;
  }
}
</style>
