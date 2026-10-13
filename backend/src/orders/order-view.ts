import type { Prisma } from '../../generated/prisma';
import { transferPlacesOf } from './share-text';

const claimerSelect = { select: { countryCode: true, phone: true, profile: true } } as const;

export const orderInclude = {
  dispatcher: { select: { countryCode: true, phone: true, profile: { select: { name: true } } } },
  claimedBy: claimerSelect,
  // 接駁: every leg of the trip, in order, through the trip's first leg.
  journeyHead: { include: { journeyLegs: { orderBy: { legIndex: 'asc' }, include: { claimedBy: claimerSelect } } } },
} satisfies Prisma.OrderInclude;

export type OrderWithPeople = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
export type JourneyLeg = NonNullable<OrderWithPeople['journeyHead']>['journeyLegs'][number];

/** The legs of the trip this order belongs to, or null when it is a single order. */
export const legsOf = (order: OrderWithPeople): JourneyLeg[] | null => order.journeyHead?.journeyLegs ?? null;

/** Whether the dispatcher drives this order themselves (這段我自己做). */
export const isSelfDriven = (order: Pick<OrderWithPeople, 'dispatcherId' | 'claimedById'>) =>
  order.claimedById === order.dispatcherId;

export type Viewer = 'dispatcher' | 'driver' | 'other';

export function viewerOf(order: Pick<OrderWithPeople, 'dispatcherId' | 'claimedById'>, userId?: string): Viewer {
  if (!userId) return 'other';
  if (order.dispatcherId === userId) return 'dispatcher';
  if (order.claimedById === userId) return 'driver';
  return 'other';
}

const money = (minor: number | null, currency: OrderWithPeople['driverCurrency']) =>
  minor === null ? null : { amount: minor / 100, currency };

export const driverPriceOf = (order: Pick<OrderWithPeople, 'driverPriceMinor' | 'driverCurrency'>) =>
  money(order.driverPriceMinor, order.driverCurrency);

export const passengerPriceOf = (order: Pick<OrderWithPeople, 'passengerPriceMinor' | 'passengerCurrency'>) =>
  money(order.passengerPriceMinor, order.passengerCurrency);

/** The dispatcher's spread; only when both prices are set in the same currency. */
export function marginOf(
  order: Pick<OrderWithPeople, 'driverPriceMinor' | 'driverCurrency' | 'passengerPriceMinor' | 'passengerCurrency'>,
) {
  if (order.driverPriceMinor === null || order.passengerPriceMinor === null) return null;
  if (order.driverCurrency !== order.passengerCurrency) return null;
  return money(order.passengerPriceMinor - order.driverPriceMinor, order.passengerCurrency);
}

function driverOf(order: Pick<OrderWithPeople, 'claimedBy'>) {
  const claimer = order.claimedBy;
  if (!claimer) return null;
  const profile = claimer.profile;
  return {
    name: profile?.name ?? null,
    hkPlate: profile?.hkPlate ?? null,
    macauPlate: profile?.macauPlate ?? null,
    mainlandPlate: profile?.mainlandPlate ?? null,
    vehicleType: profile?.vehicleType ?? null,
    seats: profile?.seats ?? null,
    color: profile?.color ?? null,
    phone: `${claimer.countryCode} ${claimer.phone}`,
  };
}

/**
 * When the winning driver may see the passenger's contact: a set number of
 * minutes before pickup, chosen by the dispatcher, or right away (null).
 */
export function contactRevealAt(order: Pick<OrderWithPeople, 'pickupAt' | 'contactRevealMinutes'>): Date | null {
  return order.contactRevealMinutes === null ? null : new Date(order.pickupAt.getTime() - order.contactRevealMinutes * 60_000);
}

export function linksOf(order: Pick<OrderWithPeople, 'code' | 'confirmCode'>, baseUrl: string) {
  return { dispatch: `${baseUrl}/o/${order.code}`, passengerConfirm: `${baseUrl}/c/${order.confirmCode}` };
}

/**
 * 接駁: the trip around this order. Anyone sees where and when each leg runs;
 * the dispatcher sees every leg's driver, and the driver of this leg sees the
 * drivers of the other legs, their phones from the time they may see the
 * passenger's contact, so they can tell each other about delays at the 接駁位置.
 */
function journeyOf(order: OrderWithPeople, viewer: Viewer, contactVisible: boolean) {
  const legs = legsOf(order);
  if (!legs || order.legIndex === null) return null;
  return {
    legIndex: order.legIndex,
    legCount: legs.length,
    transferPlaces: transferPlacesOf({ ...order, legIndex: order.legIndex, legCount: legs.length }),
    legs: legs.map((leg) => {
      const driver = viewer !== 'other' && leg.status !== 'CANCELLED' ? driverOf(leg) : null;
      return {
        legIndex: leg.legIndex,
        status: leg.status,
        pickupAt: leg.pickupAt.toISOString(),
        origin: leg.origin,
        destination: leg.destination,
        ...(viewer === 'dispatcher' ? { id: leg.id } : {}),
        ...(viewer !== 'other'
          ? { driver: driver && { ...driver, phone: contactVisible ? driver.phone : null } }
          : {}),
      };
    }),
  };
}

/**
 * The order as one viewer may see it. Passenger details and the driver's
 * contact stay hidden from everyone except the dispatcher and the driver who
 * won the claim. Drivers only ever see the driver price; the passenger price,
 * the spread and the links are only for the dispatcher.
 */
export function toOrderView(order: OrderWithPeople, viewer: Viewer, baseUrl: string, now = new Date()) {
  const participant = viewer !== 'other';
  const revealAt = contactRevealAt(order);
  // The dispatcher always sees the contact; the driver only from the reveal time on.
  const contactVisible = viewer === 'dispatcher' || !revealAt || now >= revealAt;
  return {
    code: order.code,
    status: order.status,
    pickupAt: order.pickupAt.toISOString(),
    origin: order.origin,
    destination: order.destination,
    waypoints: order.waypoints,
    passengers: order.passengers,
    luggage: order.luggage,
    vehicleType: order.vehicleType,
    driverPrice: driverPriceOf(order),
    notes: order.notes,
    requiredPlates: order.requiredPlates,
    journey: journeyOf(order, viewer, contactVisible),
    dispatcherName: order.dispatcher.profile?.name ?? null,
    claimedAt: order.claimedAt?.toISOString() ?? null,
    passengerConfirmedAt: order.passengerConfirmedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    viewer,
    ...(participant
      ? {
          id: order.id,
          passengerName: order.passengerName,
          passengerContact: contactVisible ? order.passengerContact : null,
          contactRevealAt: revealAt?.toISOString() ?? null,
          driver: driverOf(order),
          // Dispatchers publish their number in their group nickname; the winning driver gets it here.
          dispatcherPhone: `${order.dispatcher.countryCode} ${order.dispatcher.phone}`,
        }
      : {}),
    ...(viewer === 'dispatcher'
      ? {
          contactRevealMinutes: order.contactRevealMinutes,
          inPool: order.inPool,
          selfDrive: isSelfDriven(order),
          passengerPrice: passengerPriceOf(order),
          serviceFee: order.commissionMinor === null ? null : order.commissionMinor / 100,
          showPassengerPrice: order.showPassengerPrice,
          margin: marginOf(order),
          links: linksOf(order, baseUrl),
        }
      : {}),
  };
}

function passengerLeg(leg: JourneyLeg) {
  const assigned = leg.status === 'ASSIGNED' || leg.status === 'COMPLETED';
  const driver = assigned ? driverOf(leg) : null;
  return {
    legIndex: leg.legIndex,
    status: leg.status,
    pickupAt: leg.pickupAt.toISOString(),
    origin: leg.origin,
    destination: leg.destination,
    waypoints: leg.waypoints,
    vehicleType: leg.vehicleType,
    price: leg.showPassengerPrice ? passengerPriceOf(leg) : null,
    passengerConfirmedAt: leg.passengerConfirmedAt?.toISOString() ?? null,
    driver: driver && {
      name: driver.name,
      hkPlate: driver.hkPlate,
      macauPlate: driver.macauPlate,
      mainlandPlate: driver.mainlandPlate,
      vehicleType: driver.vehicleType,
      color: driver.color,
      phone: driver.phone,
    },
  };
}

/** A trip's status as the passenger sees it: cancelled legs drop out. */
function tripStatus(legs: { status: OrderWithPeople['status'] }[]): OrderWithPeople['status'] {
  const live = legs.filter((leg) => leg.status !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';
  if (live.every((leg) => leg.status === 'COMPLETED')) return 'COMPLETED';
  return live.some((leg) => leg.status === 'OPEN') ? 'OPEN' : 'ASSIGNED';
}

/**
 * What the passenger sees on the confirmation link. The driver price never
 * appears; the passenger price appears only when the dispatcher chose to show
 * it. For a trip with 接駁, the top-level fields describe the whole trip and
 * `legs` lists every leg that is not cancelled; the trip counts as confirmed
 * only when every such leg is.
 */
export function toPassengerView(order: OrderWithPeople) {
  const single = passengerLeg(order);
  const allLegs = legsOf(order);
  const legs = allLegs?.filter((leg) => leg.status !== 'CANCELLED').map(passengerLeg) ?? null;
  const shown = legs && legs.length > 0 ? legs : null;
  const confirmed = shown
    ? shown.every((leg) => leg.passengerConfirmedAt)
      ? shown.map((leg) => leg.passengerConfirmedAt as string).sort().at(-1)!
      : null
    : single.passengerConfirmedAt;
  // With one leg left (the others cancelled) the page shows that leg like a single order.
  const lead = shown ? shown[0] : single;
  return {
    status: allLegs ? tripStatus(allLegs) : order.status,
    pickupAt: lead.pickupAt,
    origin: lead.origin,
    destination: shown ? shown[shown.length - 1].destination : single.destination,
    waypoints: lead.waypoints,
    passengers: order.passengers,
    luggage: order.luggage,
    vehicleType: lead.vehicleType,
    passengerName: order.passengerName,
    price: lead.price,
    dispatcherName: order.dispatcher.profile?.name ?? null,
    passengerConfirmedAt: confirmed,
    driver: lead.driver,
    legs: shown,
  };
}
