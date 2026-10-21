<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, can, ROLE_LABEL, session, type AdminRole } from './api';
import FeedbackLayer from './components/FeedbackLayer.vue';
import { COPYRIGHT } from './copyright';
import { supportUnread, watchSupportUnread } from './support-unread';

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

// Grouped by what an operator comes to do: the day's work first, then growth, money, settings and the system itself.
const NAV: (NavLink | NavGroup)[] = [
  { to: '/', label: '總覽' },
  {
    label: '日常',
    items: [
      { to: '/support', label: '客服', roles: WRITE },
      { to: '/orders', label: '訂單' },
      { to: '/users', label: '用戶' },
    ],
  },
  {
    label: '推廣',
    items: [
      { to: '/leads', label: '潛在客戶' },
      { to: '/guides', label: '教學連結' },
      { to: '/ads', label: '廣告欄位', roles: WRITE },
    ],
  },
  {
    label: '收費',
    items: [
      { to: '/billing', label: '收費控制', roles: WRITE },
      { to: '/service-fee', label: '平台服務費', roles: WRITE },
      { to: '/payment-channels', label: '付款通道', roles: WRITE },
    ],
  },
  {
    label: '設定',
    items: [
      { to: '/settings/general', label: '一般設定', roles: WRITE },
      { to: '/settings/login', label: '登入配置', roles: WRITE },
      { to: '/settings/limits', label: '防濫用設定', roles: WRITE },
      { to: '/seo', label: 'SEO', roles: WRITE },
    ],
  },
  {
    label: '系統',
    items: [
      { to: '/observability', label: '數據流監控', roles: WRITE },
      { to: '/accounts', label: '後台帳號', roles: ['SUPER_ADMIN'] },
      { to: '/audit', label: '操作紀錄', roles: ['SUPER_ADMIN'] },
    ],
  },
];

const allowed = (item: NavLink) => !item.roles || (session.admin && item.roles.includes(session.admin.role));
const nav = computed(() =>
  NAV.map((entry) => ('items' in entry ? { ...entry, items: entry.items.filter(allowed) } : entry)).filter((entry) =>
    'items' in entry ? entry.items.length > 0 : allowed(entry),
  ),
);
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`));

/** Above each page's title: the group it sits in, so a detail page still says where it belongs. */
const section = computed(() => {
  for (const entry of NAV) {
    if ('items' in entry && entry.items.some((item) => isActive(item.to))) return entry.label;
  }
  return '管理控制台';
});

watch(
  () => can.write(),
  (on) => watchSupportUnread(on),
  { immediate: true },
);

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
        <i v-if="supportUnread.count && !mobileNavOpen" class="admin-shell__toggle-dot" aria-hidden="true"></i>
      </button>
      <nav id="admin-navigation" class="admin-shell__nav">
        <template v-for="entry in nav" :key="entry.label">
          <div v-if="'items' in entry" class="admin-shell__group">
            <div class="admin-shell__group-label">{{ entry.label }}</div>
            <div class="admin-shell__group-items">
              <RouterLink v-for="item in entry.items" :key="item.to" :to="item.to" :class="{ active: isActive(item.to) }">
                {{ item.label }}
                <span v-if="item.to === '/support' && supportUnread.count" class="admin-shell__badge" :aria-label="`${supportUnread.count} 個未讀`">
                  {{ supportUnread.count }}
                </span>
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
      <span v-if="!route.meta.detail" class="eyebrow admin-shell__eyebrow">{{ section }}</span>
      <!-- 客服 keeps its inbox while switching conversations; a list keeps itself while its filters change in the address. -->
      <RouterView :key="route.path.startsWith('/support') ? '/support' : route.path" />
    </main>
  </div>
  <template v-else>
    <RouterView />
    <!-- Only the sign-in page carries the copyright line; the pages behind it are staff tools. -->
    <footer class="admin-shell__copyright">{{ COPYRIGHT }}</footer>
  </template>
  <FeedbackLayer />
</template>

<style scoped>
.admin-shell {
  display: flex;
  min-height: 100vh;
  background: var(--color-background);
}

.admin-shell__side {
  position: sticky;
  top: 0;
  display: flex;
  flex: 0 0 232px;
  flex-direction: column;
  width: 232px;
  height: 100vh;
  padding: 24px 14px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  color: #fff;
  background: var(--gradient-side);
}

.admin-shell__brand {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 4px 12px 8px;
}

.admin-shell__brand strong {
  font-size: 17px;
  font-weight: 700;
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
  gap: 4px;
  margin-top: 18px;
}

.admin-shell__nav a,
.admin-shell__nav button,
.admin-shell__account a,
.admin-shell__account button {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
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
  color: var(--color-nav-active);
  background: var(--color-nav-active-bg);
  font-weight: 600;
}

.admin-shell__group {
  margin-top: 14px;
}

/* A small caption over each group of pages. */
.admin-shell__group-label {
  padding: 4px 10px;
  color: var(--color-nav-sub);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.admin-shell__group-items {
  display: grid;
  gap: 4px;
}

.admin-shell__group-items a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* How many 客服 conversations have a message nobody has opened yet. */
.admin-shell__badge {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  color: #fff;
  background: var(--color-danger);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
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
  padding: 16px 10px 6px;
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
  padding: 36px 40px 48px;
}

/* On the sign-in page, over the dark panel at the bottom of the window. */
.admin-shell__copyright {
  position: fixed;
  right: 0;
  bottom: 16px;
  left: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: var(--font-caption);
  text-align: center;
}

.admin-shell__eyebrow {
  margin-bottom: 8px;
}

@media (max-width: 1100px) {
  .admin-shell__side {
    flex-basis: 204px;
    width: 204px;
  }

  .admin-shell__main {
    padding: 28px 24px;
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

  /* 客服 has something unread, while the menu is folded away. */
  .admin-shell__toggle-dot {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 10px;
    height: 10px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: var(--color-danger);
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
