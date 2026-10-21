import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { api, session, type AdminAccount, type AdminRole } from './api';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    roles?: AdminRole[];
    public?: boolean;
    /** A detail page: its 返回 link stands where a list page names its section. */
    detail?: boolean;
  }
}

const WRITE: AdminRole[] = ['SUPER_ADMIN', 'OPERATOR'];

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true, title: '登入' } },
  { path: '/', component: () => import('./pages/DashboardPage.vue'), meta: { title: '總覽' } },
  { path: '/observability', component: () => import('./pages/ObservabilityPage.vue'), meta: { title: '數據流監控', roles: WRITE } },
  { path: '/users', component: () => import('./pages/UsersPage.vue'), meta: { title: '用戶' } },
  // A user's details are a drawer over the list now; links to the old page open it.
  { path: '/users/:id', redirect: (to) => ({ path: '/users', query: { open: String(to.params.id) } }) },
  { path: '/orders', component: () => import('./pages/OrdersPage.vue'), meta: { title: '訂單' } },
  { path: '/orders/:id', component: () => import('./pages/OrderDetailPage.vue'), meta: { title: '訂單詳情', detail: true } },
  { path: '/support', component: () => import('./pages/SupportPage.vue'), meta: { title: '客服', roles: WRITE } },
  { path: '/support/:id', component: () => import('./pages/SupportPage.vue'), meta: { title: '客服', roles: WRITE } },
  { path: '/billing', component: () => import('./pages/BillingPage.vue'), meta: { title: '收費控制', roles: WRITE } },
  { path: '/service-fee', component: () => import('./pages/ServiceFeePage.vue'), meta: { title: '平台服務費', roles: WRITE } },
  { path: '/settings/login', component: () => import('./pages/LoginSettingsPage.vue'), meta: { title: '登入配置', roles: WRITE } },
  // The two pages 登入配置 replaced; old links open the matching tab.
  { path: '/settings/development-login', redirect: { path: '/settings/login', query: { tab: 'development' } } },
  { path: '/leads', component: () => import('./pages/LeadsPage.vue'), meta: { title: '潛在客戶' } },
  { path: '/guides', component: () => import('./pages/GuideLinksPage.vue'), meta: { title: '教學連結' } },
  { path: '/ads', component: () => import('./pages/AdsPage.vue'), meta: { title: '廣告欄位', roles: WRITE } },
  { path: '/seo', component: () => import('./pages/SeoPage.vue'), meta: { title: 'SEO', roles: WRITE } },
  { path: '/settings/general', component: () => import('./pages/GeneralSettingsPage.vue'), meta: { title: '一般設定', roles: WRITE } },
  { path: '/settings/limits', component: () => import('./pages/LimitsPage.vue'), meta: { title: '防濫用設定', roles: WRITE } },
  { path: '/payment-channels', component: () => import('./pages/PaymentChannelsPage.vue'), meta: { title: '付款通道', roles: WRITE } },
  { path: '/sms-channels', redirect: { path: '/settings/login', query: { tab: 'sms' } } },
  { path: '/accounts', component: () => import('./pages/AccountsPage.vue'), meta: { title: '後台帳號', roles: ['SUPER_ADMIN'] } },
  { path: '/audit', component: () => import('./pages/AuditPage.vue'), meta: { title: '操作紀錄', roles: ['SUPER_ADMIN'] } },
  { path: '/password', component: () => import('./pages/PasswordPage.vue'), meta: { title: '修改密碼' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  if (!session.checked) {
    try {
      session.admin = (await api<{ admin: AdminAccount }>('GET', '/auth/me')).admin;
    } catch {
      session.admin = null;
    }
    session.checked = true;
  }
  if (to.meta.public) return session.admin ? '/' : true;
  if (!session.admin) return { path: '/login', query: { next: to.fullPath } };
  if (to.meta.roles && !to.meta.roles.includes(session.admin.role)) return '/';
  return true;
});

router.afterEach((to) => {
  document.title = `${to.meta.title ?? ''}｜MasterDriver 平台後台`;
});
