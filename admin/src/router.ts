import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { api, session, type AdminAccount, type AdminRole } from './api';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    roles?: AdminRole[];
    public?: boolean;
  }
}

const WRITE: AdminRole[] = ['SUPER_ADMIN', 'OPERATOR'];

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true, title: '登入' } },
  { path: '/', component: () => import('./pages/DashboardPage.vue'), meta: { title: '總覽' } },
  { path: '/users', component: () => import('./pages/UsersPage.vue'), meta: { title: '用戶' } },
  { path: '/users/:id', component: () => import('./pages/UserDetailPage.vue'), meta: { title: '用戶詳情' } },
  { path: '/orders', component: () => import('./pages/OrdersPage.vue'), meta: { title: '訂單' } },
  { path: '/orders/:id', component: () => import('./pages/OrderDetailPage.vue'), meta: { title: '訂單詳情' } },
  { path: '/billing', component: () => import('./pages/BillingPage.vue'), meta: { title: '收費控制', roles: WRITE } },
  { path: '/service-fee', component: () => import('./pages/ServiceFeePage.vue'), meta: { title: '平台服務費', roles: WRITE } },
  {
    path: '/settings/development-login',
    component: () => import('./pages/DevelopmentLoginPage.vue'),
    meta: { title: '登入配置：開發模式登入', roles: WRITE },
  },
  { path: '/leads', component: () => import('./pages/LeadsPage.vue'), meta: { title: '潛在客戶' } },
  { path: '/ads', component: () => import('./pages/AdsPage.vue'), meta: { title: '廣告欄位', roles: WRITE } },
  { path: '/seo', component: () => import('./pages/SeoPage.vue'), meta: { title: 'SEO', roles: WRITE } },
  { path: '/settings/general', component: () => import('./pages/GeneralSettingsPage.vue'), meta: { title: '一般設定', roles: WRITE } },
  { path: '/payment-channels', component: () => import('./pages/PaymentChannelsPage.vue'), meta: { title: '付款通道', roles: WRITE } },
  { path: '/sms-channels', component: () => import('./pages/SmsChannelsPage.vue'), meta: { title: '簡訊通道', roles: WRITE } },
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
