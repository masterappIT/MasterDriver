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
  /** 航班號 of an airport pickup or drop-off. */
  flightNo?: string | null;
  /** 即時單: leaves now, so the group reads 現在出發 instead of a time. */
  immediate?: boolean;
  /** 接駁 or 往返: this order's place in its trip; absent or null for a single order. */
  legIndex?: number | null;
  legCount?: number;
  /** What the trip is; absent or TRANSFER for 接駁. */
  journeyKind?: 'TRANSFER' | 'ROUND_TRIP' | null;
  /** 往返: one driver takes both legs (同一位司機來回). */
  sameDriver?: boolean;
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

/** When the order leaves, as the group reads it: 現在出發 for 即時單. */
function when(order: ShareOrder) {
  return order.immediate ? '現在出發' : formatPickup(order.pickupAt);
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

/** 往返: the way there is 去程, the way back 回程. */
export function roundTripLegName(legIndex: number): string {
  return legIndex === 1 ? '去程' : '回程';
}

const isRoundTrip = (order: ShareOrder) => order.journeyKind === 'ROUND_TRIP';

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
  const transfer = leg && !isRoundTrip(order) ? leg : null;
  return [
    route(order),
    leg && isRoundTrip(order) ? `往返：${roundTripLegName(leg.legIndex)}` : null,
    transfer ? `接駁：${legLabel(transfer.legIndex, transfer.legCount)}` : null,
    transfer ? `接駁位置：${transferPlacesOf(transfer).join('、')}` : null,
    plateRequirement(order.requiredPlates),
    order.waypoints.length > 0 ? `途經：${order.waypoints.join('、')}` : null,
    order.flightNo ? `航班：${order.flightNo}` : null,
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
  const heading = order.immediate ? '【即時】現在出發' : `【有單】${formatPickup(order.pickupAt)}`;
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
  const heading = first.immediate ? '【即時・接駁】現在出發' : `【有單・接駁】${formatPickup(first.pickupAt)}`;
  const load = [`${first.passengers}人`, `${first.luggage}件行李`, first.vehicleType].filter(Boolean).join('｜');
  const legLines = legs.map((leg, index) => {
    const parts = leg.selfDriven
      ? ['出單者自己開']
      : [plateRequirement(leg.requiredPlates), leg.driverPriceMinor !== null ? formatPrice(leg.driverPriceMinor, leg.driverCurrency) : null];
    const detail = parts.filter((part): part is string => part !== null).join('｜');
    return `第 ${leg.legIndex ?? index + 1} 段：${when(leg)} ${route(leg)}${detail ? `｜${detail}` : ''}`;
  });
  const body = [
    `${first.origin} → ${first.destination}（換車）→ ${last.destination}`,
    ...legLines,
    first.waypoints.length > 0 ? `途經：${first.waypoints.join('、')}` : null,
    first.flightNo ? `航班：${first.flightNo}` : null,
    load,
    first.notes ? `備註：${first.notes}` : null,
    `搶單（選一段）：${dispatchUrl}`,
  ].filter((line): line is string => line !== null);
  return { wechat: [heading, ...body].join('\n'), whatsapp: [`*${heading}*`, ...body].join('\n') };
}

/**
 * 往返 同一位司機來回: what the one driver is paid for both legs, when every leg has a driver price
 * in the same currency and none is the dispatcher's own; null otherwise.
 */
export function roundTripTotal(legs: (Pick<ShareOrder, 'driverPriceMinor' | 'driverCurrency'> & { selfDriven?: boolean })[]) {
  if (legs.length < 2 || legs.some((leg) => leg.selfDriven || leg.driverPriceMinor === null)) return null;
  if (legs.some((leg) => leg.driverCurrency !== legs[0].driverCurrency)) return null;
  return formatPrice(
    legs.reduce((sum, leg) => sum + (leg.driverPriceMinor ?? 0), 0),
    legs[0].driverCurrency,
  );
}

/**
 * 往返: the whole order in one text with one link, the way there's. Each leg says its time, places,
 * flight and driver price; whether one driver takes both legs is said, with what both legs pay
 * together, so drivers know what they claim.
 */
export function roundTripShareText(legs: ShareLeg[], dispatchUrl: string) {
  const first = legs[0];
  const sameDriver = Boolean(first.sameDriver);
  const heading = first.immediate ? '【即時・往返】現在出發' : `【有單・往返】${formatPickup(first.pickupAt)}`;
  const load = [`${first.passengers}人`, `${first.luggage}件行李`, first.vehicleType].filter(Boolean).join('｜');
  // Each leg has its own flight: the way there lands, the way back takes off.
  const legLines = legs.map((leg, index) => {
    const parts = leg.selfDriven
      ? [leg.flightNo ? `航班 ${leg.flightNo}` : null, '出單者自己開']
      : [leg.flightNo ? `航班 ${leg.flightNo}` : null, leg.driverPriceMinor !== null ? formatPrice(leg.driverPriceMinor, leg.driverCurrency) : null];
    const detail = parts.filter((part): part is string => part !== null).join('｜');
    return `${roundTripLegName(leg.legIndex ?? index + 1)}：${when(leg)} ${route(leg)}${detail ? `｜${detail}` : ''}`;
  });
  const total = sameDriver ? roundTripTotal(legs) : null;
  const body = [
    // The way back the way there reversed reads A ⇄ B; other places are in the leg lines only.
    isReversed(legs) ? `${first.origin} ⇄ ${first.destination}` : null,
    ...legLines,
    sameDriver ? (total ? `同一位司機來回，來回共 ${total}` : '同一位司機來回') : '可分開接，選一程搶',
    plateRequirement(first.requiredPlates),
    first.waypoints.length > 0 ? `途經：${first.waypoints.join('、')}` : null,
    load,
    first.notes ? `備註：${first.notes}` : null,
    `${sameDriver ? '搶單（來回）' : '搶單（選一程）'}：${dispatchUrl}`,
  ].filter((line): line is string => line !== null);
  return { wechat: [heading, ...body].join('\n'), whatsapp: [`*${heading}*`, ...body].join('\n') };
}

/** 往返: the way back is the way there reversed (A to B, then B to A). */
export function isReversed(legs: Pick<ShareOrder, 'origin' | 'destination'>[]) {
  return legs.length === 2 && legs[1].origin === legs[0].destination && legs[1].destination === legs[0].origin;
}

/** What a claimed leg is, after its route: （接駁第 1 段）, （回程）, or （來回） for both legs at once. */
function legNote(order: ShareOrder) {
  if (!order.legIndex) return '';
  if (!isRoundTrip(order)) return `（接駁第 ${order.legIndex} 段）`;
  return order.sameDriver ? '（來回）' : `（${roundTripLegName(order.legIndex)}）`;
}

/**
 * Text the dispatcher pastes back into the group once a driver has the order (or one leg of it).
 * 往返 同一位司機來回 is one job: it reads from the way there and says when the way back leaves.
 */
export function claimedShareText(order: ShareOrder, driver: ShareDriver, legs?: ShareOrder[]): string {
  const plates = [driver.hkPlate, driver.macauPlate, driver.mainlandPlate].filter(Boolean).join(' / ');
  const together = isRoundTrip(order) && order.sameDriver && legs && legs.length > 1 ? legs : null;
  const heading = together
    ? `【已派出】${formatPickup(together[0].pickupAt)} ${route(together[0])}（來回，回程 ${formatPickup(together[together.length - 1].pickupAt)}）`
    : `【已派出】${formatPickup(order.pickupAt)} ${route(order)}${legNote(order)}`;
  return [
    heading,
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
  if (legs && legs.length > 1 && isRoundTrip(legs[0])) {
    // 往返: the passenger sees both times and the way back.
    const trips = legs.map((leg) => `${roundTripLegName(leg.legIndex ?? 1)} ${formatPickup(leg.pickupAt)} ${route(leg)}`).join('，');
    return `您好，您的往返行程（${trips}）已安排${shownPassengerPrice(legs)}，請按連結查看並確認：${confirmUrl}`;
  }
  if (legs && legs.length > 1) {
    // The passenger only needs to know the car changes on the way, not where.
    const first = legs[0];
    const last = legs[legs.length - 1];
    const trip = `${first.origin} → ${last.destination}（接駁，中途換車）`;
    return `您好，您的行程 ${formatPickup(first.pickupAt)} ${trip} 已安排${shownPassengerPrice(legs)}，請按連結查看兩位司機並確認：${confirmUrl}`;
  }
  return `您好，您的行程 ${formatPickup(order.pickupAt)} ${route(order)} 已安排${shownPassengerPrice([order])}，請按連結查看並確認：${confirmUrl}`;
}

/** 拼車: the parties on a carpool order, as drivers need them before claiming. */
export interface ShareCarpool {
  partyCount: number;
  /** 上車點, each once, in the order the parties asked. */
  stops: string[];
}

/**
 * A carpool order in one text: where the parties get on, how many parties and people, and the
 * driver price. Never a passenger's name, phone or fare.
 */
export function carpoolShareText(order: ShareOrder, carpool: ShareCarpool, dispatchUrl: string) {
  const heading = `【有單・拼車】${formatPickup(order.pickupAt)}`;
  const load = [`${carpool.partyCount}組`, `${order.passengers}人`, `${order.luggage}件行李`, order.vehicleType].filter(Boolean).join('｜');
  const body = [
    route(order),
    carpool.stops.length > 0 ? `上車點：${carpool.stops.join('、')}` : null,
    `拼車：${load}`,
    order.driverPriceMinor !== null ? formatPrice(order.driverPriceMinor, order.driverCurrency) : null,
    order.notes ? `備註：${order.notes}` : null,
    `搶單：${dispatchUrl}`,
  ].filter((line): line is string => line !== null);
  return { wechat: [heading, ...body].join('\n'), whatsapp: [`*${heading}*`, ...body].join('\n') };
}
