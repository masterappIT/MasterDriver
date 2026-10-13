/**
 * 數據流監控's live events on this instance. Anything may emit; nothing is built or sent while
 * no admin page is watching. Business steps (出單, 搶單…) and database queries are told here so
 * the page can light up the 業務服務 and 資料庫 nodes, as on Master Travel's page.
 */

export type TelemetrySource = 'driver' | 'passenger' | 'admin' | 'backend' | 'service' | 'data';

export interface TelemetryEvent {
  type: 'request:end' | 'domain:end' | 'data:end';
  source: TelemetrySource;
  status: 'success' | 'error' | string;
  timestamp: string;
  method?: string;
  /** The route, not the address: /api/c/:confirmCode, never the passenger's own link. */
  path?: string;
  operation?: string;
  httpStatus?: number;
  durationMs?: number;
  category?: 'application' | 'health';
  region?: string;
  client?: Client;
}

export type Client = 'WECHAT' | 'WHATSAPP' | 'BROWSER' | 'NONE';

type Listener = (event: TelemetryEvent) => void;
const listeners = new Set<Listener>();

export const telemetry = {
  get watched() {
    return listeners.size > 0;
  },
  listen(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emit(event: Omit<TelemetryEvent, 'timestamp'>) {
    if (listeners.size === 0) return;
    const stamped = { ...event, timestamp: new Date().toISOString() } as TelemetryEvent;
    for (const listener of listeners) listener(stamped);
  },
  /** A business step finished: 出單, 搶單, 乘客確認, 完成, 取消, 新預約, 發簡訊. */
  domain(operation: string, status: 'success' | 'error' | string = 'success') {
    telemetry.emit({ type: 'domain:end', source: 'service', operation, status });
  },
};

// ------------------------------------------------------------ classification

/** Which part of MasterDriver a request belongs to, by its route. */
export function sourceOf(path: string): TelemetrySource {
  if (path.startsWith('/api/admin')) return 'admin';
  if (path.startsWith('/api/health')) return 'backend';
  // The passenger's confirmation link, the 名片頁 and the booking link: opened without an account.
  if (path.startsWith('/api/c/') || path.startsWith('/api/public/profiles') || path.startsWith('/api/public/bookings')) return 'passenger';
  if (path.startsWith('/api/public')) return 'backend';
  return 'driver';
}

export const categoryOf = (path: string): 'application' | 'health' => (path.startsWith('/api/health') ? 'health' : 'application');

/** Long-lived streams are counted as connections, not requests; the monitor does not watch itself. */
export const observed = (path: string) => path !== '/api/admin/observability/stream' && path !== '/api/notifications/stream';

/**
 * Where the page was opened. WhatsApp often opens links in the phone's own browser, so a
 * WhatsApp visit can also count as 其他瀏覽器.
 */
export function clientOf(userAgent: string | undefined): Client {
  if (!userAgent) return 'NONE';
  if (/MicroMessenger/i.test(userAgent)) return 'WECHAT';
  if (/WhatsApp/i.test(userAgent)) return 'WHATSAPP';
  if (/Mozilla\//.test(userAgent)) return 'BROWSER';
  return 'NONE';
}

/** "SELECT Order", "UPDATE Notification", from a query Prisma ran; nothing else of the SQL. */
export function queryOperation(sql: string) {
  const verb = /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.exec(sql)?.[1]?.toUpperCase();
  if (!verb) return null;
  const table = /"public"\."(\w+)"/.exec(sql)?.[1];
  return table ? `${verb} ${table}` : verb;
}

/** 00:00 of the day in Hong Kong (UTC+8) that `date` falls on, as the date column stores it. */
export const hongKongDay = (date = new Date()) => new Date(`${new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`);
