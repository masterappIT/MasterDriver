import type { Prisma } from '../../generated/prisma';

export const orderInclude = {
  dispatcher: { select: { countryCode: true, phone: true, profile: { select: { name: true } } } },
  claimedBy: { select: { countryCode: true, phone: true, profile: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithPeople = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

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

function driverOf(order: OrderWithPeople) {
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
          passengerPrice: passengerPriceOf(order),
          serviceFee: order.commissionMinor === null ? null : order.commissionMinor / 100,
          showPassengerPrice: order.showPassengerPrice,
          margin: marginOf(order),
          links: linksOf(order, baseUrl),
        }
      : {}),
  };
}

/**
 * What the passenger sees on the confirmation link. The driver price never
 * appears; the passenger price appears only when the dispatcher chose to show it.
 */
export function toPassengerView(order: OrderWithPeople) {
  const assigned = order.status === 'ASSIGNED' || order.status === 'COMPLETED';
  const driver = assigned ? driverOf(order) : null;
  return {
    status: order.status,
    pickupAt: order.pickupAt.toISOString(),
    origin: order.origin,
    destination: order.destination,
    waypoints: order.waypoints,
    passengers: order.passengers,
    luggage: order.luggage,
    vehicleType: order.vehicleType,
    passengerName: order.passengerName,
    price: order.showPassengerPrice ? passengerPriceOf(order) : null,
    dispatcherName: order.dispatcher.profile?.name ?? null,
    passengerConfirmedAt: order.passengerConfirmedAt?.toISOString() ?? null,
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
