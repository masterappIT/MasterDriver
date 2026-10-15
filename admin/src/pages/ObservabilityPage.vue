<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { can } from '../api';
import { dateTime } from '../format';

/**
 * 數據流監控, after Master Travel's 項目數據流 page (see docs/REUSE.md): the request flow as a
 * mind map, live events, region visits, live presence with the super admin's user list, and
 * warnings. MasterDriver adds the day's business numbers, speed and errors by area, which
 * browser people use, open 通知 streams against capacity, SMS, and the outside services.
 *
 * Live events and the mind map come from the API instance this page is connected to; every
 * number in the snapshot adds up all instances.
 */

type Source = 'admin' | 'passenger' | 'driver' | 'backend' | 'service' | 'data';
type Client = 'WECHAT' | 'WHATSAPP' | 'BROWSER' | 'NONE';

interface LiveEvent {
  id: string;
  type: string;
  source: Source;
  status: string;
  timestamp: string;
  method?: string;
  path?: string;
  operation?: string;
  httpStatus?: number;
  durationMs?: number;
  region?: string;
  client?: Client;
}

interface PresenceBucket {
  count: number;
  regions: Record<string, number>;
}

interface Snapshot {
  type: 'snapshot';
  day: string;
  checkedAt: string;
  instances: number;
  write: { status: 'pending' | 'ok' | 'error'; at: string | null };
  presence: { activity: Record<string, PresenceBucket>; connections: Record<string, PresenceBucket>; windowMs: number };
  regions: { region: string; source: string; client: string; count: number }[];
  areas: { area: string; count: number; errors: number; clientErrors: number; slow: number; averageMs: number | null }[];
  clients: { client: Client; source: string; count: number }[];
  business: { orders: number; claimsWon: number; claimsLost: number; confirmed: number; completed: number; cancelled: number; bookings: number; users: number };
  sms: { today: { provider: string; route: string; status: string; count: number }[]; lastSent: { provider: string; route: string; at: string | null }[] };
  streams: { open: number; capacity: number; perInstance: number };
  services: { database: { ok: boolean; ms: number | null }; storage: { ok: boolean } };
}

interface Identity {
  userId: string;
  phone: string;
  name: string | null;
  client: Client;
  region: string;
  connected: boolean;
  lastActivityAt: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  admin: '管理後台',
  passenger: '乘客頁',
  driver: '司機端',
  backend: 'API Gateway',
  service: '業務服務',
  data: '資料庫',
};
const CLIENT_LABEL: Record<Client, string> = { WECHAT: '微信內', WHATSAPP: 'WhatsApp 內', BROWSER: '其他瀏覽器', NONE: '非瀏覽器' };
const AREA_LABEL: Record<string, string> = {
  MAINLAND: '中國內地',
  HONG_KONG: '香港',
  MACAU: '澳門',
  OTHER: '其他地區',
  INTERNAL: '本機／內網',
  UNKNOWN: '未知地區',
};
const AREA_ORDER = ['MAINLAND', 'HONG_KONG', 'MACAU', 'OTHER', 'UNKNOWN', 'INTERNAL'];
const OPERATION_LABEL: Record<string, string> = {
  'order.create': '出單',
  'order.claim': '搶單',
  'order.confirm': '乘客確認',
  'order.complete': '完成行程',
  'order.cancel': '取消訂單',
  'booking.create': '名片頁預約',
  'sms.sms253': '簡訊 253',
  'sms.spug': '簡訊 Spug',
};
const SMS_PROVIDER: Record<string, string> = { SMS253: '253 雲通訊', SPUG: 'Spug 推送助手' };
const SMS_ROUTE: Record<string, string> = { DOMESTIC: '國內（+86）', INTERNATIONAL: '國際（+852／+853）' };

const MAX_EVENTS = 30;
const PAGE_SIZE = 10;

const events = ref<LiveEvent[]>([]);
const eventPage = ref(1);
const connected = ref(false);
const error = ref('');
const snapshot = ref<Snapshot | null>(null);
const snapshotFailedAt = ref('');
const clock = ref(Date.now());
const nodeStats = ref<Record<Source, number>>({ admin: 0, passenger: 0, driver: 0, backend: 0, service: 0, data: 0 });
const activeSource = ref<Source | ''>('');

interface Anomaly extends LiveEvent {
  key: string;
  severity: 'warning' | 'critical';
  reason: string;
  count: number;
}
const anomalies = ref<Anomaly[]>([]);

// ---------------------------------------------------------------- the mind map

const FLOW_PATHS: Record<Source, string> = {
  admin: 'M500 280 C350 245 220 150 115 100',
  passenger: 'M500 280 C360 300 225 295 105 285',
  driver: 'M500 280 C360 340 230 430 120 465',
  backend: 'M500 280 C650 245 780 150 890 100',
  service: 'M500 280 C650 300 790 295 900 285',
  data: 'M500 280 C650 340 780 430 885 465',
};
const molecules = ref<{ id: string; source: Source; error: boolean; path: string; born: number }[]>([]);
let moleculeTimer: ReturnType<typeof setTimeout> | undefined;
let activeTimer: ReturnType<typeof setTimeout> | undefined;

function lightUp(event: LiveEvent) {
  const source = event.source in FLOW_PATHS ? event.source : 'backend';
  nodeStats.value[source] += 1;
  activeSource.value = source;
  clearTimeout(activeTimer);
  activeTimer = setTimeout(() => (activeSource.value = ''), 900);
  molecules.value = [...molecules.value.slice(-17), { id: `${Date.now()}-${Math.random()}`, source, error: event.status === 'error', path: FLOW_PATHS[source], born: Date.now() }];
  clearTimeout(moleculeTimer);
  moleculeTimer = setTimeout(() => (molecules.value = molecules.value.filter((entry) => Date.now() - entry.born < 2600)), 2800);
}

/** Code rain behind the map: digits only, so nothing reads as a symbol or icon. */
const codeRain = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  text: Array.from({ length: 18 + (index % 7) }, (_, character) => '0123456789ABCDEF'.charAt((index * 5 + character * 3) % 16)).join(''),
  left: `${(index * 3.71) % 100}%`,
  delay: `${-((index * 1.37) % 9).toFixed(2)}s`,
  duration: `${7 + (index % 6) * 1.1}s`,
}));

// ------------------------------------------------------------------- warnings

/** As on Master Travel: failed requests and slow ones (800 ms a warning, over 2 seconds critical), grouped. */
function detectAnomaly(event: LiveEvent) {
  if (event.type !== 'request:end' && event.type !== 'domain:end') return;
  const duration = Number(event.durationMs);
  const status = Number(event.httpStatus) || null;
  const failed = event.status === 'error';
  const severity: Anomaly['severity'] | '' = failed
    ? status && status >= 400 && status < 500 && status !== 408 && status !== 429
      ? 'warning'
      : 'critical'
    : duration > 2000
      ? 'critical'
      : duration >= 800
        ? 'warning'
        : '';
  if (!severity) return;
  const reason = failed
    ? status === 401
      ? '未授權請求'
      : status === 403
        ? '權限不足'
        : status === 408
          ? '請求逾時'
          : status === 429
            ? '請求受限'
            : status && status >= 400 && status < 500
              ? '用戶端請求失敗'
              : '請求失敗'
    : duration > 2000
      ? '請求延遲超過 2000 ms'
      : '請求延遲至少 800 ms';
  const key = `${event.method ?? event.type}|${event.path ?? event.operation}|${status ?? ''}|${reason}`;
  const existing = anomalies.value.find((entry) => entry.key === key);
  anomalies.value = [{ ...event, key, severity, reason, count: (existing?.count ?? 0) + 1 }, ...anomalies.value.filter((entry) => entry.key !== key)].slice(0, 12);
}

// --------------------------------------------------------------------- stream

let controller: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

function receive(item: Record<string, unknown>) {
  if (item.type === 'snapshot') {
    snapshot.value = item as unknown as Snapshot;
    snapshotFailedAt.value = '';
    return;
  }
  if (item.type === 'snapshot:error') {
    snapshotFailedAt.value = String(item.checkedAt);
    return;
  }
  if (item.type === 'stream:connected') return;
  const event = { ...(item as unknown as LiveEvent), id: `${Date.now()}-${Math.random()}` };
  lightUp(event);
  detectAnomaly(event);
  // Database queries light up their node only; the list keeps requests and business steps.
  if (event.type === 'data:end') return;
  events.value = [event, ...events.value].slice(0, MAX_EVENTS);
}

async function connect() {
  if (stopped) return;
  clearTimeout(reconnectTimer);
  controller = new AbortController();
  const signal = controller.signal;
  let opened = false;
  try {
    const response = await fetch('/api/admin/observability/stream', { credentials: 'same-origin', headers: { 'x-md-admin': '1', accept: 'text/event-stream' }, signal });
    if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
    opened = true;
    connected.value = true;
    error.value = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (!data) continue;
        try {
          receive(JSON.parse(data) as Record<string, unknown>);
        } catch {
          /* a malformed packet is skipped */
        }
      }
    }
  } catch {
    if (signal.aborted) return;
  }
  if (stopped) return;
  // The server ends each stream after a while: reconnect at once. One that failed waits a little.
  if (opened) {
    void connect();
  } else {
    connected.value = false;
    error.value = '即時串流暫時中斷，正在重試';
    reconnectTimer = setTimeout(() => void connect(), 3000);
  }
}

// ----------------------------------------------------- the super admin's list

const identities = ref<Identity[]>([]);
const identityError = ref('');
const identityLoading = ref(false);
let identityTimer: ReturnType<typeof setInterval> | undefined;

async function loadIdentities() {
  identityLoading.value = true;
  try {
    const response = await fetch('/api/admin/observability/presence-identities', { credentials: 'same-origin', headers: { 'x-md-admin': '1' } });
    if (!response.ok) throw new Error(String(response.status));
    identities.value = ((await response.json()) as { users: Identity[] }).users;
    identityError.value = '';
  } catch {
    identityError.value = '用戶明細暫時無法載入';
  } finally {
    identityLoading.value = false;
  }
}

const freshness = setInterval(() => (clock.value = Date.now()), 15_000);

onMounted(() => {
  void connect();
  if (can.superAdmin()) {
    void loadIdentities();
    identityTimer = setInterval(() => void loadIdentities(), 15_000);
  }
});

onBeforeUnmount(() => {
  stopped = true;
  controller?.abort();
  clearTimeout(reconnectTimer);
  clearTimeout(activeTimer);
  clearTimeout(moleculeTimer);
  clearInterval(identityTimer);
  clearInterval(freshness);
});

// -------------------------------------------------------------- what is shown

const pageCount = computed(() => Math.max(1, Math.ceil(events.value.length / PAGE_SIZE)));
const pagedEvents = computed(() => events.value.slice((eventPage.value - 1) * PAGE_SIZE, eventPage.value * PAGE_SIZE));
watch(pageCount, (count) => {
  if (eventPage.value > count) eventPage.value = count;
});

const snapshotState = computed(() => {
  if (snapshotFailedAt.value) return '讀取失敗';
  if (!snapshot.value) return '等待資料';
  return clock.value - Date.parse(snapshot.value.checkedAt) > 45_000 ? '資料逾時' : '讀取正常';
});

/** 地區訪問: requests per region today, with which parts and browsers they came from. */
const regionStats = computed(() => {
  const counts = new Map<string, { region: string; count: number; sources: Set<string> }>();
  for (const row of snapshot.value?.regions ?? []) {
    const current = counts.get(row.region) ?? { region: row.region, count: 0, sources: new Set<string>() };
    current.count += row.count;
    current.sources.add(SOURCE_LABEL[row.source] ?? row.source);
    counts.set(row.region, current);
  }
  return [...counts.values()].map((item) => ({ ...item, sources: [...item.sources] })).sort((a, b) => b.count - a.count);
});
const regionParticles = computed(() =>
  regionStats.value.flatMap((item) => Array.from({ length: Math.min(8, Math.max(2, Math.ceil(item.count / 2))) }, (_, index) => ({ region: item.region, index }))),
);
const geoParticlesVisible = computed(() => regionStats.value.some((item) => item.region !== '未知地區'));

/** 地區速度與錯誤: the areas MasterDriver serves first, then the rest. */
const areaRows = computed(() =>
  [...(snapshot.value?.areas ?? [])]
    .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area))
    .map((row) => ({ ...row, errorRate: row.count ? (row.errors / row.count) * 100 : 0 })),
);

/** 用甚麼打開: requests by browser, for the driver app and the passenger pages. */
const clientRows = computed(() => {
  const rows = (Object.keys(CLIENT_LABEL) as Client[]).map((client) => {
    const of = (source: string) => snapshot.value?.clients.filter((row) => row.client === client && row.source === source).reduce((sum, row) => sum + row.count, 0) ?? 0;
    return { client, driver: of('driver'), passenger: of('passenger') };
  });
  const total = (key: 'driver' | 'passenger') => rows.reduce((sum, row) => sum + row[key], 0);
  return rows.map((row) => ({
    ...row,
    driverShare: total('driver') ? Math.round((row.driver / total('driver')) * 100) : 0,
    passengerShare: total('passenger') ? Math.round((row.passenger / total('passenger')) * 100) : 0,
  }));
});

const PRESENCE_GROUPS = [
  { key: 'driver:WECHAT', label: '司機端 微信內' },
  { key: 'driver:WHATSAPP', label: '司機端 WhatsApp 內' },
  { key: 'driver:BROWSER', label: '司機端 其他瀏覽器' },
  { key: 'passenger:WECHAT', label: '乘客頁 微信內' },
  { key: 'passenger:WHATSAPP', label: '乘客頁 WhatsApp 內' },
  { key: 'passenger:BROWSER', label: '乘客頁 其他瀏覽器' },
];
const presenceGroups = computed(() =>
  PRESENCE_GROUPS.map((group) => ({
    ...group,
    passengerPage: group.key.startsWith('passenger'),
    activity: snapshot.value?.presence.activity[group.key] ?? { count: 0, regions: {} },
    connections: snapshot.value?.presence.connections[group.key] ?? { count: 0, regions: {} },
  })),
);

const streamLoad = computed(() => {
  const streams = snapshot.value?.streams;
  if (!streams || !streams.capacity) return { percent: 0, level: 'ok' as const };
  const percent = Math.round((streams.open / streams.capacity) * 100);
  return { percent, level: percent >= 85 ? ('critical' as const) : percent >= 70 ? ('warning' as const) : ('ok' as const) };
});

const smsRows = computed(() => {
  const keyOf = (row: { provider: string; route: string }) => `${row.provider}|${row.route}`;
  const rows = new Map<string, { provider: string; route: string; sent: number; failed: number; lastSent: string | null }>();
  for (const row of snapshot.value?.sms.today ?? []) {
    const current = rows.get(keyOf(row)) ?? { provider: row.provider, route: row.route, sent: 0, failed: 0, lastSent: null };
    if (row.status === 'sent') current.sent += row.count;
    else current.failed += row.count;
    rows.set(keyOf(row), current);
  }
  for (const row of snapshot.value?.sms.lastSent ?? []) {
    const current = rows.get(keyOf(row)) ?? { provider: row.provider, route: row.route, sent: 0, failed: 0, lastSent: null };
    current.lastSent = row.at;
    rows.set(keyOf(row), current);
  }
  return [...rows.values()];
});

const time = (iso: string) => new Date(iso).toLocaleTimeString();
const eventName = (event: LiveEvent) => event.method ?? (event.operation ? (OPERATION_LABEL[event.operation] ?? event.operation) : event.type);
const eventState = (event: LiveEvent) =>
  `${event.httpStatus ? `HTTP ${event.httpStatus} · ` : ''}${event.status === 'lost' ? '慢了一步' : event.status === 'error' ? '失敗' : '成功'}`;
</script>

<template>
  <section class="project-observability">
    <div class="page-head">
      <div>
        <h1>數據流監控</h1>
        <p class="page-head__desc">以 Mind Map 即時呈現整個項目的請求流動</p>
      </div>
      <div class="stream-status"><span :class="['status-dot', { connected }]"></span>{{ connected ? 'LIVE' : 'RECONNECTING' }}</div>
    </div>

    <div class="mind-map-stage">
      <div class="mind-map-grid"></div>
      <div class="mind-map-code-rain" aria-hidden="true">
        <span
          v-for="column in codeRain"
          :key="column.id"
          class="mind-map-code-column"
          :style="{ '--rain-left': column.left, '--rain-delay': column.delay, '--rain-duration': column.duration }"
          >{{ column.text }}</span
        >
      </div>
      <svg class="mind-map-links" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <filter id="observability-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="flow-cyan">
            <stop stop-color="#35e5ff" stop-opacity="0" />
            <stop offset=".5" stop-color="#35e5ff" />
            <stop offset="1" stop-color="#35e5ff" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path v-for="(path, source) in FLOW_PATHS" :key="source" class="map-link" :d="path" />
        <path class="map-flow" :d="FLOW_PATHS.passenger" />
        <path class="map-flow map-flow-delay" :d="FLOW_PATHS.service" />
        <circle class="map-packet" r="5"><animateMotion dur="2.8s" repeatCount="indefinite" :path="FLOW_PATHS.passenger" /></circle>
        <circle class="map-packet" r="5"><animateMotion dur="3.4s" repeatCount="indefinite" :path="FLOW_PATHS.backend" /></circle>
        <circle class="map-packet" r="5"><animateMotion dur="2.5s" repeatCount="indefinite" :path="FLOW_PATHS.data" /></circle>
        <circle class="map-packet" r="3"><animateMotion dur="3.1s" repeatCount="indefinite" :path="FLOW_PATHS.admin" /></circle>
        <g v-if="geoParticlesVisible" class="geo-service-particles">
          <circle class="geo-service-particle geo-service-particle-one" r="3"><animateMotion dur="2.8s" repeatCount="indefinite" :path="FLOW_PATHS.service" /></circle>
          <circle class="geo-service-particle geo-service-particle-two" r="2.5"><animateMotion dur="3.6s" begin="-1.2s" repeatCount="indefinite" :path="FLOW_PATHS.service" /></circle>
          <circle class="geo-service-particle geo-service-particle-three" r="2"><animateMotion dur="4.2s" begin="-2.4s" repeatCount="indefinite" :path="FLOW_PATHS.service" /></circle>
        </g>
        <circle v-for="molecule in molecules" :key="molecule.id" :class="['event-molecule', { 'is-error': molecule.error }]" r="5">
          <animateMotion dur="1.4s" repeatCount="1" fill="freeze" :path="molecule.path" keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
        </circle>
      </svg>

      <article class="mind-node node-core">
        <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" /></svg>
        <b>MASTERDRIVER</b>
        <small>LIVE PROJECT FLOW</small>
        <strong>{{ events.length }} / {{ MAX_EVENTS }} EVENTS</strong>
      </article>
      <article :class="['mind-node node-admin', { 'is-active': activeSource === 'admin' }]">
        <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
        <b>ADMIN</b><small>管理後台</small><strong>{{ nodeStats.admin }} EVENTS</strong>
      </article>
      <article :class="['mind-node node-passenger', { 'is-active': activeSource === 'passenger' }]">
        <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
        <b>PASSENGER</b><small>乘客頁</small><strong>{{ nodeStats.passenger }} EVENTS</strong>
      </article>
      <article :class="['mind-node node-driver', { 'is-active': activeSource === 'driver' }]">
        <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16l1.5-5h11L19 16M4 16h16v3H4zM7 19v2M17 19v2" /></svg>
        <b>DRIVER</b><small>司機端</small><strong>{{ nodeStats.driver }} EVENTS</strong>
      </article>
      <article :class="['mind-node node-api', { 'is-active': activeSource === 'backend' }]">
        <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        <b>API GATEWAY</b><small>NestJS</small><strong>{{ nodeStats.backend }} EVENTS</strong>
      </article>
      <article :class="['mind-node node-service', { 'is-active': activeSource === 'service' }]">
        <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12l2 2 4-4" /></svg>
        <b>DOMAIN SERVICE</b><small>業務服務</small><strong>{{ nodeStats.service }} EVENTS</strong>
      </article>
      <article :class="['mind-node node-data', { 'is-active': activeSource === 'data' }]">
        <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></svg>
        <b>DATA LAYER</b><small>Prisma / PostgreSQL</small><strong>{{ nodeStats.data }} EVENTS</strong>
      </article>
    </div>

    <!-- MasterDriver: the day's business, from the records themselves. -->
    <div class="business-panel">
      <div class="panel-title">
        <h3>今日業務</h3>
        <span>{{ snapshot ? `UTC+8 ${snapshot.day}　全站` : '等待資料' }}</span>
      </div>
      <div class="business-grid">
        <div class="business-metric"><strong>{{ snapshot?.business.orders ?? '—' }}</strong><small>出單</small></div>
        <div class="business-metric"><strong>{{ snapshot?.business.claimsWon ?? '—' }}</strong><small>搶到</small></div>
        <div class="business-metric"><strong>{{ snapshot?.business.claimsLost ?? '—' }}</strong><small>慢了一步</small></div>
        <div class="business-metric"><strong>{{ snapshot?.business.confirmed ?? '—' }}</strong><small>乘客確認</small></div>
        <div class="business-metric"><strong>{{ snapshot?.business.completed ?? '—' }}</strong><small>完成</small></div>
        <div class="business-metric"><strong>{{ snapshot?.business.cancelled ?? '—' }}</strong><small>取消</small></div>
        <div class="business-metric"><strong>{{ snapshot?.business.bookings ?? '—' }}</strong><small>名片頁預約</small></div>
        <div class="business-metric"><strong>{{ snapshot?.business.users ?? '—' }}</strong><small>新用戶</small></div>
      </div>
    </div>

    <div class="telemetry-panel">
      <div class="panel-title">
        <h3>即時事件</h3>
        <span>最近 {{ events.length }} / {{ MAX_EVENTS }} 筆</span>
      </div>
      <p class="observability-note">
        本頁連線的那台伺服器的即時事件；保留最近 {{ MAX_EVENTS }} 筆（排除健康檢查與資料庫查詢），不代表全站總量。節點數字為本頁連線期間收到的事件次數；資料庫節點計算每一次查詢。路徑顯示路由樣式，例如 /api/c/:confirmCode，不顯示乘客的連結。
      </p>
      <p v-if="error" class="stream-error">{{ error }}</p>
      <div v-if="!events.length" class="stream-empty">等待下一個 API 事件</div>
      <div v-for="event in pagedEvents" :key="event.id" class="event-row">
        <span :class="['event-pulse', { 'is-error': event.status === 'error' }]"></span>
        <time>{{ time(event.timestamp) }}</time>
        <b>{{ eventName(event) }}</b>
        <span class="event-path">{{ event.path ?? SOURCE_LABEL[event.source] ?? 'system' }}</span>
        <span v-if="event.durationMs != null" class="event-duration">{{ event.durationMs }} ms</span>
        <span v-else class="event-duration"></span>
        <span class="event-state">{{ eventState(event) }}</span>
      </div>
      <div v-if="events.length > PAGE_SIZE" class="event-pagination">
        <button type="button" :disabled="eventPage <= 1" @click="eventPage -= 1">上一頁</button>
        <span>{{ eventPage }} / {{ pageCount }}</span>
        <button type="button" :disabled="eventPage >= pageCount" @click="eventPage += 1">下一頁</button>
      </div>
    </div>

    <!-- MasterDriver: speed and errors by area, the mainland first. -->
    <div class="area-panel">
      <div class="panel-title">
        <h3>地區速度與錯誤</h3>
        <span>今日全站，不含健康檢查</span>
      </div>
      <p class="observability-note">伺服器處理請求的時間，不含手機到伺服器的網路時間。錯誤指伺服器出錯（500 以上）；用戶端錯誤（400 到 499）多數是連結過期、未登入或資料不正確。</p>
      <div class="observability-table-scroll">
        <table class="observability-table">
          <thead>
            <tr><th>地區</th><th>請求</th><th>平均處理</th><th>慢（800 ms 以上）</th><th>錯誤</th><th>錯誤率</th><th>用戶端錯誤</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in areaRows" :key="row.area" :class="{ 'is-critical': row.errorRate >= 1 }">
              <td>{{ AREA_LABEL[row.area] ?? row.area }}</td>
              <td>{{ row.count }}</td>
              <td>{{ row.averageMs == null ? '—' : `${row.averageMs} ms` }}</td>
              <td>{{ row.slow }}</td>
              <td>{{ row.errors }}</td>
              <td>{{ row.errorRate.toFixed(1) }}%</td>
              <td>{{ row.clientErrors }}</td>
            </tr>
            <tr v-if="!areaRows.length"><td colspan="7" class="observability-empty-cell">今天還沒有請求</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- MasterDriver: where people open it, to see 紅線 2 (WeChat) in practice. -->
    <div class="client-panel">
      <div class="panel-title">
        <h3>用甚麼打開</h3>
        <span>今日請求數</span>
      </div>
      <p class="observability-note">按瀏覽器識別。WhatsApp 常用手機自己的瀏覽器打開連結，所以部分 WhatsApp 用戶會算進「其他瀏覽器」。</p>
      <div class="client-grid">
        <article v-for="row in clientRows" :key="row.client" class="client-card">
          <b>{{ CLIENT_LABEL[row.client] }}</b>
          <div class="client-line"><span>司機端</span><strong>{{ row.driver }}</strong><small>{{ row.driverShare }}%</small></div>
          <div class="client-bar"><span :style="{ width: `${row.driverShare}%` }"></span></div>
          <div class="client-line"><span>乘客頁</span><strong>{{ row.passenger }}</strong><small>{{ row.passengerShare }}%</small></div>
          <div class="client-bar client-bar--passenger"><span :style="{ width: `${row.passengerShare}%` }"></span></div>
        </article>
      </div>
    </div>

    <div class="region-visit-panel">
      <div class="panel-title">
        <h3>地區訪問</h3>
        <span>{{ regionStats.length }} 個地區</span>
      </div>
      <p class="observability-note">UTC+8 {{ snapshot?.day ?? '當日' }} 請求完成次數（含健康檢查）；非人數或獨立 IP。約每 15 秒讀取一次；IP 只用來查地區，不保存。</p>
      <p class="observability-health">
        地區讀取：{{ snapshotState }}<span v-if="snapshot"> · 最近檢查 {{ time(snapshot.checkedAt) }}</span>；這台伺服器最近一次寫入統計：{{
          snapshot?.write.status === 'ok' ? '正常' : snapshot?.write.status === 'error' ? '失敗' : '尚未確認'
        }}<span v-if="snapshot?.write.at"> · {{ time(snapshot.write.at) }}</span>
      </p>
      <p class="region-data-credit">IP Geolocation by <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">DB-IP</a></p>
      <div class="region-visit-orbit">
        <span v-for="particle in regionParticles" :key="particle.region + '-' + particle.index" class="region-particle" :style="{ '--particle-delay': particle.index * -0.35 + 's' }"></span>
        <div class="region-visit-core">REGION<br />FLOW</div>
      </div>
      <div v-if="!regionStats.length" class="region-empty">{{ snapshotFailedAt ? '地區資料讀取失敗' : '等待地區訪問事件' }}</div>
      <div v-else class="region-visit-list">
        <div v-for="item in regionStats" :key="item.region" class="region-visit-row">
          <div><b>{{ item.region }}</b><small>{{ item.sources.join(' · ') || '未知端別' }}</small></div>
          <strong>{{ item.count }}</strong>
        </div>
      </div>
    </div>

    <div class="presence-panel">
      <div class="panel-title">
        <h3>即時在線用戶</h3>
        <span>活動 5 分鐘／連線中　全站</span>
      </div>
      <p class="region-data-credit">IP Geolocation by <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">DB-IP</a></p>
      <p class="observability-note">司機以帳號計，同一人在兩台伺服器只算一次。乘客頁不用登入，以手機計，在兩台伺服器出現時可能算兩次。「目前連線」是開著 MasterDriver、收得到通知的司機。</p>
      <div class="presence-grid">
        <article v-for="item in presenceGroups" :key="item.key" class="presence-card">
          <div class="presence-card-heading"><span class="presence-indicator" aria-hidden="true"></span><b>{{ item.label }}</b></div>
          <div class="presence-metrics">
            <div class="presence-metric"><strong>{{ item.activity.count }}</strong><small>近 5 分鐘活動</small></div>
            <div class="presence-metric">
              <strong>{{ item.passengerPage ? '—' : item.connections.count }}</strong><small>{{ item.passengerPage ? '乘客頁不保持連線' : '目前連線' }}</small>
            </div>
          </div>
          <div class="presence-regions">
            <div class="presence-region-group">
              <span>活動地區</span>
              <ul>
                <li v-for="(count, region) in item.activity.regions" :key="region"><span>{{ region }}</span><b>{{ count }}</b></li>
                <li v-if="!Object.keys(item.activity.regions).length" class="presence-region-empty">尚無地區資料</li>
              </ul>
            </div>
            <div v-if="!item.passengerPage" class="presence-region-group">
              <span>連線地區</span>
              <ul>
                <li v-for="(count, region) in item.connections.regions" :key="region"><span>{{ region }}</span><b>{{ count }}</b></li>
                <li v-if="!Object.keys(item.connections.regions).length" class="presence-region-empty">尚無地區資料</li>
              </ul>
            </div>
          </div>
        </article>
      </div>

      <div v-if="can.superAdmin()" class="presence-identity-panel">
        <div class="panel-title">
          <h3>司機訪問明細</h3>
          <span>僅超級管理員可見 · 每 15 秒更新</span>
        </div>
        <p class="observability-note">只顯示近 5 分鐘有活動或目前連線的司機；乘客頁不用登入，不列個人。地區按最近一次請求或連線的 IP 推算，可能因內網、代理或定位資料顯示為未知。</p>
        <p v-if="identityError" class="stream-error">{{ identityError }}</p>
        <p v-else-if="identityLoading && !identities.length" class="stream-empty">正在載入用戶明細</p>
        <div class="presence-identity-scroll">
          <table class="presence-identity-table">
            <thead>
              <tr><th>司機</th><th>登入號碼</th><th>打開方式</th><th>訪問地區</th><th>狀態</th><th>最近活動</th></tr>
            </thead>
            <tbody>
              <tr v-if="!identities.length"><td colspan="6" class="presence-identity-empty">目前沒有活動或連線的司機</td></tr>
              <tr v-for="user in identities" :key="user.userId">
                <td><RouterLink :to="`/users/${user.userId}`">{{ user.name ?? '未填資料' }}</RouterLink></td>
                <td>{{ user.phone }}</td>
                <td>{{ CLIENT_LABEL[user.client] }}</td>
                <td>{{ user.region || '未知地區' }}</td>
                <td>{{ user.connected ? '連線中' : '近 5 分鐘活動' }}</td>
                <td>{{ user.lastActivityAt ? time(user.lastActivityAt) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- MasterDriver: 通知 streams against what the API can hold. -->
    <div :class="['capacity-panel', `is-${streamLoad.level}`]">
      <div class="panel-title">
        <h3>通知即時連線</h3>
        <span>全站</span>
      </div>
      <div class="capacity-numbers">
        <strong>{{ snapshot?.streams.open ?? '—' }}</strong>
        <span>/ 約 {{ snapshot?.streams.capacity ?? '—' }}</span>
        <small>{{ streamLoad.percent }}%</small>
      </div>
      <div class="capacity-bar"><span :style="{ width: `${Math.min(100, streamLoad.percent)}%` }"></span></div>
      <p class="observability-note">
        每個開著 MasterDriver 的司機佔伺服器一個連線。上限按目前在線的 {{ snapshot?.instances ?? '—' }} 台伺服器、每台 {{ snapshot?.streams.perInstance ?? 80 }} 個計算；正式環境最多 3 台。到 70% 時要考慮調高 Cloud Run 的並行數或台數，否則其他請求會開始變慢。
      </p>
    </div>

    <!-- MasterDriver: SMS and the services the platform depends on. -->
    <div class="services-panel">
      <div class="panel-title">
        <h3>簡訊與外部服務</h3>
        <span>{{ snapshot ? `最近檢查 ${time(snapshot.checkedAt)}` : '等待資料' }}</span>
      </div>
      <div class="services-grid">
        <article :class="['service-card', snapshot?.services.database.ok === false ? 'is-down' : '']">
          <b>資料庫</b>
          <strong>{{ !snapshot ? '—' : snapshot.services.database.ok ? `${snapshot.services.database.ms} ms` : '連不上' }}</strong>
          <small>從伺服器查詢一次的時間</small>
        </article>
        <article :class="['service-card', snapshot?.services.storage.ok === false ? 'is-down' : '']">
          <b>檔案儲存</b>
          <strong>{{ !snapshot ? '—' : snapshot.services.storage.ok ? '可用' : '未設定' }}</strong>
          <small>客服圖片影片、名片頁照片</small>
        </article>
        <article class="service-card">
          <b>伺服器</b>
          <strong>{{ snapshot?.instances ?? '—' }} 台</strong>
          <small>最近 45 秒有回報的 API 伺服器</small>
        </article>
      </div>
      <div class="observability-table-scroll">
        <table class="observability-table">
          <thead>
            <tr><th>簡訊通道</th><th>帳號</th><th>今日送出</th><th>今日失敗</th><th>最近一次送出</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in smsRows" :key="`${row.provider}-${row.route}`" :class="{ 'is-critical': row.failed > 0 && row.sent === 0 }">
              <td>{{ SMS_PROVIDER[row.provider] ?? row.provider }}</td>
              <td>{{ SMS_ROUTE[row.route] ?? row.route }}</td>
              <td>{{ row.sent }}</td>
              <td>{{ row.failed }}</td>
              <td>{{ row.lastSent ? dateTime(row.lastSent) : '—' }}</td>
            </tr>
            <tr v-if="!smsRows.length"><td colspan="5" class="observability-empty-cell">還沒有發過簡訊（開發模式登入時不發簡訊）</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="anomaly-panel">
      <div class="panel-title">
        <h3>警告與異常</h3>
        <span>{{ anomalies.length }} 類（最多 12 類，本頁連線期間）</span>
      </div>
      <div v-if="!anomalies.length" class="anomaly-empty">目前沒有偵測到警告或異常</div>
      <div v-for="anomaly in anomalies" :key="anomaly.key" :class="['anomaly-row', `is-${anomaly.severity}`]">
        <span class="anomaly-mark">{{ anomaly.severity === 'critical' ? '嚴重' : '警告' }}</span>
        <div>
          <b>{{ anomaly.reason }} · {{ anomaly.count }} 次<span v-if="anomaly.httpStatus"> · HTTP {{ anomaly.httpStatus }}</span></b>
          <small>{{ eventName(anomaly) }} · {{ anomaly.path ?? anomaly.operation ?? 'system' }}</small>
        </div>
        <time>最近 {{ time(anomaly.timestamp) }}</time>
      </div>
    </div>
  </section>
</template>

<style src="../styles/observability.css"></style>
