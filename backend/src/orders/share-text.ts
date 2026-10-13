import { formatPickup } from '../common/hong-kong-time';

const CURRENCY_PREFIX = { HKD: 'HK$', CNY: 'RMB¥', MOP: 'MOP$' } as const;

export interface ShareOrder {
  pickupAt: Date;
  origin: string;
  destination: string;
  waypoints: string[];
  passengers: number;
  luggage: number;
  vehicleType: string | null;
  driverPriceMinor: number | null;
  driverCurrency: keyof typeof CURRENCY_PREFIX;
  passengerPriceMinor: number | null;
  passengerCurrency: keyof typeof CURRENCY_PREFIX;
  showPassengerPrice: boolean;
  notes: string | null;
  /** 接駁: this order's place in its trip; absent or null for a single order. */
  legIndex?: number | null;
  legCount?: number;
  handoffNote?: string | null;
}

export interface ShareDriver {
  name: string | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
}

export function formatPrice(priceMinor: number, currency: keyof typeof CURRENCY_PREFIX): string {
  const amount = (priceMinor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${CURRENCY_PREFIX[currency]}${amount}`;
}

function route(order: ShareOrder) {
  return `${order.origin} → ${order.destination}`;
}

function dispatchLines(order: ShareOrder): string[] {
  const load = [`${order.passengers}人`, `${order.luggage}件行李`, order.vehicleType].filter(Boolean).join('｜');
  return [
    route(order),
    order.legIndex ? `接駁：第 ${order.legIndex}／${order.legCount ?? order.legIndex} 段` : null,
    order.legIndex && order.handoffNote ? `交接：${order.handoffNote}` : null,
    order.waypoints.length > 0 ? `途經：${order.waypoints.join('、')}` : null,
    load,
    order.driverPriceMinor !== null ? formatPrice(order.driverPriceMinor, order.driverCurrency) : null,
    order.notes ? `備註：${order.notes}` : null,
  ].filter((line): line is string => line !== null);
}

/**
 * Text the dispatcher pastes into a group. It must make sense on its own,
 * because WeChat usually shows our link without a preview card. It carries
 * the driver price only; the passenger's contact and price never appear here.
 */
export function dispatchShareText(order: ShareOrder, dispatchUrl: string) {
  const heading = `【有單】${formatPickup(order.pickupAt)}`;
  const body = [...dispatchLines(order), `搶單：${dispatchUrl}`];
  return {
    wechat: [heading, ...body].join('\n'),
    // WhatsApp renders *text* in bold.
    whatsapp: [`*${heading}*`, ...body].join('\n'),
  };
}

/** Text the dispatcher pastes back into the group once a driver has the order. */
export function claimedShareText(order: ShareOrder, driver: ShareDriver): string {
  const plates = [driver.hkPlate, driver.macauPlate, driver.mainlandPlate].filter(Boolean).join(' / ');
  return [
    `【已派出】${formatPickup(order.pickupAt)} ${route(order)}`,
    driver.name ? `司機：${driver.name}` : null,
    plates ? `車牌：${plates}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** The passenger price to quote: the shown prices added up, when they share one currency. */
function shownPassengerPrice(legs: ShareOrder[]) {
  const shown = legs.filter((leg) => leg.showPassengerPrice && leg.passengerPriceMinor !== null);
  if (shown.length === 0 || new Set(shown.map((leg) => leg.passengerCurrency)).size > 1) return '';
  const total = shown.reduce((sum, leg) => sum + (leg.passengerPriceMinor as number), 0);
  return `，費用 ${formatPrice(total, shown[0].passengerCurrency)}`;
}

/**
 * Message the dispatcher sends the passenger with the confirmation link. It
 * never carries the driver price; the passenger price only when shown. For a
 * trip with 接駁, pass its legs that are not cancelled: the message covers the
 * whole trip and the link (the first leg's) shows every leg.
 */
export function passengerShareText(order: ShareOrder, confirmUrl: string, legs?: ShareOrder[]): string {
  if (legs && legs.length > 1) {
    const first = legs[0];
    const last = legs[legs.length - 1];
    const trip = `${first.origin} → ${last.destination}（${legs.length} 段接駁）`;
    return `您好，您的行程 ${formatPickup(first.pickupAt)} ${trip} 已安排${shownPassengerPrice(legs)}，請按連結查看各段司機並確認：${confirmUrl}`;
  }
  return `您好，您的行程 ${formatPickup(order.pickupAt)} ${route(order)} 已安排${shownPassengerPrice([order])}，請按連結查看並確認：${confirmUrl}`;
}
