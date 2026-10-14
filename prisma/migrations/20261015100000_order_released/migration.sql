-- 取消接單: the dispatcher is told when the driver gives an order (or a 接駁 leg) back (2026-10-15).
ALTER TYPE "NotificationKind" ADD VALUE 'ORDER_RELEASED';
