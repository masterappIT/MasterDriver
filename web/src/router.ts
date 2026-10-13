import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { loadSession, session } from './api';

declare module 'vue-router' {
  interface RouteMeta {
    /** Pages inside the signed-in driver app, with the tab bar. */
    app?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  // The platform's public home page; signed-in users go straight to the driver app (see the guard below).
  { path: '/', component: () => import('./pages/LandingPage.vue') },
  { path: '/legal/:kind(terms|privacy)', component: () => import('./pages/LegalPage.vue') },
  // Opened from group links: kept as their own small chunks so they load first.
  { path: '/o/:code', component: () => import('./pages/ClaimPage.vue') },
  { path: '/c/:confirmCode', component: () => import('./pages/ConfirmPage.vue') },
  // 名片頁 and the passenger's booking link: public, no account.
  { path: '/p/:code', component: () => import('./pages/ProfilePublicPage.vue') },
  { path: '/b/:code', component: () => import('./pages/BookingStatusPage.vue') },
  { path: '/login', component: () => import('./pages/LoginPage.vue') },
  // 客服: for signed-in users and for guests, so it sits outside the signed-in app.
  { path: '/support', component: () => import('./pages/SupportPage.vue') },
  { path: '/app', component: () => import('./pages/HomePage.vue'), meta: { app: true } },
  { path: '/app/new', component: () => import('./pages/NewOrderPage.vue'), meta: { app: true } },
  { path: '/app/orders', component: () => import('./pages/OrdersPage.vue'), meta: { app: true } },
  { path: '/app/orders/:id', component: () => import('./pages/OrderDetailPage.vue'), meta: { app: true } },
  { path: '/app/me', component: () => import('./pages/MePage.vue'), meta: { app: true } },
  { path: '/app/profile-page', component: () => import('./pages/MyProfilePagePage.vue'), meta: { app: true } },
  { path: '/app/bookings', component: () => import('./pages/BookingsPage.vue'), meta: { app: true } },
  { path: '/app/bookings/:id', component: () => import('./pages/BookingDetailPage.vue'), meta: { app: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  // The passenger page never needs the driver's session.
  if (to.path.startsWith('/c/') || to.path.startsWith('/b/')) return true;
  if (!session.checked) await loadSession();
  if (to.meta.app && !session.user) return { path: '/login', query: { next: to.fullPath } };
  if ((to.path === '/login' || to.path === '/') && session.user) return '/app';
  return true;
});
