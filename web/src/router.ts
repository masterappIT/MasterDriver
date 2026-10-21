import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { ensureSession, session } from './api';

declare module 'vue-router' {
  interface RouteMeta {
    /** Pages inside the signed-in driver app, with the tab bar. */
    app?: boolean;
    /** Pages that end with the copyright line: those seen from outside, the ways in, and 我的. */
    copyright?: boolean;
    /** Opens without waiting to find out who is signed in; that is found out alongside. */
    sessionLater?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  // The platform's public home page; signed-in users go straight to the driver app (see the guard below).
  { path: '/', component: () => import('./pages/LandingPage.vue') },
  { path: '/legal/:kind(terms|privacy)', component: () => import('./pages/LegalPage.vue'), meta: { copyright: true, sessionLater: true } },
  // Opened from group links: kept as their own small chunks so they load first.
  { path: '/o/:code', component: () => import('./pages/ClaimPage.vue'), meta: { copyright: true, sessionLater: true } },
  { path: '/c/:confirmCode', component: () => import('./pages/ConfirmPage.vue'), meta: { copyright: true } },
  // 名片頁 and the passenger's booking link: public, no account.
  { path: '/p/:code', component: () => import('./pages/ProfilePublicPage.vue'), meta: { copyright: true, sessionLater: true } },
  { path: '/b/:code', component: () => import('./pages/BookingStatusPage.vue'), meta: { copyright: true } },
  // 拼車: the link a driver gives passengers, and a passenger's own seats. Public, no account.
  { path: '/r/:code', component: () => import('./pages/CarpoolPublicPage.vue'), meta: { copyright: true, sessionLater: true } },
  { path: '/s/:code', component: () => import('./pages/CarpoolSeatPage.vue'), meta: { copyright: true } },
  // 特價車: the link a driver gives passengers; the booking it makes is followed on /b/. Public, no account.
  { path: '/d/:code', component: () => import('./pages/DealPublicPage.vue'), meta: { copyright: true, sessionLater: true } },
  { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { copyright: true } },
  // 客服: for signed-in users and for guests, so it sits outside the signed-in app.
  { path: '/support', component: () => import('./pages/SupportPage.vue') },
  { path: '/app', component: () => import('./pages/HomePage.vue'), meta: { app: true } },
  { path: '/app/pool', component: () => import('./pages/PoolPage.vue'), meta: { app: true } },
  { path: '/app/new', component: () => import('./pages/NewOrderPage.vue'), meta: { app: true } },
  { path: '/app/orders', component: () => import('./pages/OrdersPage.vue'), meta: { app: true } },
  { path: '/app/orders/:id/share', component: () => import('./pages/SharePage.vue'), meta: { app: true } },
  { path: '/app/orders/:id', component: () => import('./pages/OrderDetailPage.vue'), meta: { app: true } },
  { path: '/app/me', component: () => import('./pages/MePage.vue'), meta: { app: true, copyright: true } },
  { path: '/app/notifications', component: () => import('./pages/NotificationsPage.vue'), meta: { app: true } },
  { path: '/app/notification-settings', component: () => import('./pages/NotificationSettingsPage.vue'), meta: { app: true } },
  { path: '/app/profile', component: () => import('./pages/ProfileEditPage.vue'), meta: { app: true } },
  { path: '/app/guide/customers', component: () => import('./pages/CustomerGuidePage.vue'), meta: { app: true } },
  { path: '/app/profile-page', component: () => import('./pages/MyProfilePagePage.vue'), meta: { app: true } },
  { path: '/app/passengers', component: () => import('./pages/PassengersPage.vue'), meta: { app: true } },
  { path: '/app/drivers', component: () => import('./pages/MyDriversPage.vue'), meta: { app: true } },
  { path: '/app/payment-methods', component: () => import('./pages/PaymentMethodsPage.vue'), meta: { app: true } },
  { path: '/app/bookings', component: () => import('./pages/BookingsPage.vue'), meta: { app: true } },
  { path: '/app/bookings/:id', component: () => import('./pages/BookingDetailPage.vue'), meta: { app: true } },
  { path: '/app/carpools', component: () => import('./pages/CarpoolsPage.vue'), meta: { app: true } },
  { path: '/app/carpools/new', component: () => import('./pages/CarpoolNewPage.vue'), meta: { app: true } },
  { path: '/app/carpools/:id', component: () => import('./pages/CarpoolDetailPage.vue'), meta: { app: true } },
  { path: '/app/deals', component: () => import('./pages/DealsPage.vue'), meta: { app: true } },
  { path: '/app/deals/new', component: () => import('./pages/DealFormPage.vue'), meta: { app: true } },
  { path: '/app/deals/:id/edit', component: () => import('./pages/DealFormPage.vue'), meta: { app: true } },
  { path: '/app/deals/:id', component: () => import('./pages/DealDetailPage.vue'), meta: { app: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  // The passenger page never needs the driver's session.
  if (to.path.startsWith('/c/') || to.path.startsWith('/b/') || to.path.startsWith('/s/')) return true;
  // The pages opened from a group or by passengers show at once, even while the server wakes up.
  if (to.meta.sessionLater) {
    void ensureSession();
    return true;
  }
  await ensureSession();
  if (to.meta.app && !session.user) return { path: '/login', query: { next: to.fullPath } };
  if ((to.path === '/login' || to.path === '/') && session.user) return '/app';
  return true;
});
