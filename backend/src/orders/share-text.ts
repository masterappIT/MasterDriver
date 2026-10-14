import { formatPickup } from '../common/hong-kong-time';

const CURRENCY_PREFIX = { HKD: 'HK$', CNY: 'RMB¥', MOP: 'MOP$' } as const;
const PLATE_NAME = { HK: '香港', MACAU: '澳門', MAINLAND: '內地' } as const;
export type PlateRegion = keyof typeof PLATE_NAME;

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
  requiredPlates?: PlateRegion[];
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

/**
 * 接駁: where this leg meets its neighbours. A leg after the first starts at
 * one; a leg with another after it ends at one, and so does a first leg whose
 * next leg has not been added yet.
 */
export function transferPlacesOf(leg: { legIndex: number; legCount: number; origin: string; destination: string }): string[] {
  const places = [
    leg.legIndex > 1 ? leg.origin : null,
    leg.legIndex < leg.legCount || leg.legCount === 1 ? leg.destination : null,
  ];
  return places.filter((place): place is string => place !== null);
}

/** "第 2／2 段", or "第 1 段" while the trip's other legs are still to be added. */
export function legLabel(legIndex: number, legCount: number): string {
  return legCount > 1 ? `第 ${legIndex}／${legCount} 段` : `第 ${legIndex} 段`;
}

/** "需澳門車" or "需香港＋澳門車牌"; null when the order asks for no plate. */
export function plateRequirement(plates: PlateRegion[] | undefined): string | null {
  if (!plates || plates.length === 0) return null;
  const names = plates.map((plate) => PLATE_NAME[plate]);
  return names.length === 1 ? `需${names[0]}車` : `需${names.join('＋')}車牌`;
}

function dispatchLines(order: ShareOrder): string[] {
  // No luggage is said too ("1人｜0件行李"): a line without it reads as if it was left out.
  const load = [`${order.passengers}人`, `${order.luggage}件行李`, order.vehicleType].filter(Boolean).join('｜');
  const leg = order.legIndex ? { ...order, legIndex: order.legIndex, legCount: order.legCount ?? order.legIndex } : null;
  return [
    route(order),
    leg ? `接駁：${legLabel(leg.legIndex, leg.legCount)}` : null,
    leg ? `接駁位置：${transferPlacesOf(leg).join('、')}` : null,
    plateRequirement(order.requiredPlates),
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

/** A leg of a 接駁 order, for its group text. */
export type ShareLeg = ShareOrder & { legIndex: number | null; selfDriven: boolean };

/**
 * 接駁: the whole order in one text with one link, the first leg's, where a driver picks the leg
 * to take. Each leg says its time, places, plates and driver price; a leg the dispatcher drives
 * themselves is named so nobody waits for it.
 */
export function transferShareText(legs: ShareLeg[], dispatchUrl: string) {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const heading = `【有單・接駁】${formatPickup(first.pickupAt)}`;
  const load = [`${first.passengers}人`, `${first.luggage}件行李`, first.vehicleType].filter(Boolean).join('｜');
  const legLines = legs.map((leg, index) => {
    const parts = leg.selfDriven
      ? ['出單者自己開']
      : [plateRequirement(leg.requiredPlates), leg.driverPriceMinor !== null ? formatPrice(leg.driverPriceMinor, leg.driverCurrency) : null];
    const detail = parts.filter((part): part is string => part !== null).join('｜');
    return `第 ${leg.legIndex ?? index + 1} 段：${formatPickup(leg.pickupAt)} ${route(leg)}${detail ? `｜${detail}` : ''}`;
  });
  const body = [
    `${first.origin} → ${first.destination}（換車）→ ${last.destination}`,
    ...legLines,
    first.waypoints.length > 0 ? `途經：${first.waypoints.join('、')}` : null,
    load,
    first.notes ? `備註：${first.notes}` : null,
    `搶單（選一段）：${dispatchUrl}`,
  ].filter((line): line is string => line !== null);
  return { wechat: [heading, ...body].join('\n'), whatsapp: [`*${heading}*`, ...body].join('\n') };
}

/** Text the dispatcher pastes back into the group once a driver has the order (or one leg of it). */
export function claimedShareText(order: ShareOrder, driver: ShareDriver): string {
  const plates = [driver.hkPlate, driver.macauPlate, driver.mainlandPlate].filter(Boolean).join(' / ');
  return [
    `【已派出】${formatPickup(order.pickupAt)} ${route(order)}${order.legIndex ? `（接駁第 ${order.legIndex} 段）` : ''}`,
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
    // The passenger only needs to know the car changes on the way, not where.
    const first = legs[0];
    const last = legs[legs.length - 1];
    const trip = `${first.origin} → ${last.destination}（接駁，中途換車）`;
    return `您好，您的行程 ${formatPickup(first.pickupAt)} ${trip} 已安排${shownPassengerPrice(legs)}，請按連結查看兩位司機並確認：${confirmUrl}`;
  }
  return `您好，您的行程 ${formatPickup(order.pickupAt)} ${route(order)} 已安排${shownPassengerPrice([order])}，請按連結查看並確認：${confirmUrl}`;
}
