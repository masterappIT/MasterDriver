import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { loadSession, session } from './api';

declare module 'vue-router' {
  interface RouteMeta {
    /** Pages inside the signed-in driver app, with the tab bar. */
    app?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/app' },
  // Opened from group links: kept as their own small chunks so they load first.
  { path: '/o/:code', component: () => import('./pages/ClaimPage.vue') },
  { path: '/c/:confirmCode', component: () => import('./pages/ConfirmPage.vue') },
  { path: '/login', component: () => import('./pages/LoginPage.vue') },
  // 客服: for signed-in users and for guests, so it sits outside the signed-in app.
  { path: '/support', component: () => import('./pages/SupportPage.vue') },
  { path: '/app', component: () => import('./pages/HomePage.vue'), meta: { app: true } },
  { path: '/app/new', component: () => import('./pages/NewOrderPage.vue'), meta: { app: true } },
  { path: '/app/orders', component: () => import('./pages/OrdersPage.vue'), meta: { app: true } },
  { path: '/app/orders/:id', component: () => import('./pages/OrderDetailPage.vue'), meta: { app: true } },
  { path: '/app/me', component: () => import('./pages/MePage.vue'), meta: { app: true } },
  { path: '/:pathMatch(.*)*', redirect: '/app' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  // The passenger page never needs the driver's session.
  if (to.path.startsWith('/c/')) return true;
  if (!session.checked) await loadSession();
  if (to.meta.app && !session.user) return { path: '/login', query: { next: to.fullPath } };
  if (to.path === '/login' && session.user) return '/app';
  return true;
});
