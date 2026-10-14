import { PROFILE_PHOTO_MAX } from '@masterdriver/shared';
import type { Prisma } from '../../generated/prisma';
import { transferPlacesOf } from './share-text';

/** The 名片頁 fields that say how to reach someone, and whether the page is public. */
const contactPageSelect = { select: { code: true, published: true, wechatId: true, whatsapp: true } } as const;
/**
 * The driver's page also carries the vehicle photo, which the passenger sees on their link. A page
 * from when several were allowed gives its newest.
 */
const driverPageSelect = {
  select: { ...contactPageSelect.select, photos: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: PROFILE_PHOTO_MAX } },
} as const;
const claimerSelect = { select: { countryCode: true, phone: true, profile: true, profilePage: driverPageSelect } } as const;

/** 行程群 without its image: what the views need. */
const tripGroupSelect = { select: { platform: true, inviteUrl: true, qrMime: true, expiresAt: true, updatedAt: true } } as const;

export const orderInclude = {
  dispatcher: {
    select: { countryCode: true, phone: true, profile: { select: { name: true, hkMacauPhone: true, mainlandPhone: true } }, profilePage: contactPageSelect },
  },
  claimedBy: claimerSelect,
  // 接駁: every leg of the trip, in order, through the trip's first leg.
  journeyHead: { include: { journeyLegs: { orderBy: { legIndex: 'asc' }, include: { claimedBy: claimerSelect } }, tripGroup: tripGroupSelect } },
  // 行程群: on the order itself, or on the first leg of its trip.
  tripGroup: tripGroupSelect,
  // 預約: whether the order was made from a passenger's booking request.
  booking: { select: { id: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithPeople = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
export type JourneyLeg = NonNullable<OrderWithPeople['journeyHead']>['journeyLegs'][number];

/** The legs of the trip this order belongs to, or null when it is a single order. */
export const legsOf = (order: OrderWithPeople): JourneyLeg[] | null => order.journeyHead?.journeyLegs ?? null;

/** Whether the dispatcher drives this order themselves (這單我自己做). */
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

/**
 * The spread the dispatcher sees. On a 接駁 order the passenger's one price, kept on the first
 * leg, is set against both legs' driver prices (a leg the dispatcher drives pays nobody); the
 * second leg shows none.
 */
function spreadOf(order: OrderWithPeople) {
  const legs = legsOf(order)?.filter((leg) => leg.status !== 'CANCELLED');
  if (!legs || legs.length < 2) return marginOf(order);
  if (order.legIndex !== 1 || order.passengerPriceMinor === null) return null;
  const paid = legs.filter((leg) => leg.claimedById !== order.dispatcherId);
  if (paid.some((leg) => leg.driverPriceMinor === null || leg.driverCurrency !== order.passengerCurrency)) return null;
  return money(order.passengerPriceMinor - paid.reduce((sum, leg) => sum + (leg.driverPriceMinor as number), 0), order.passengerCurrency);
}

type ContactPage = { code: string; published: boolean; wechatId: string; whatsapp: string } | null;

/**
 * The WeChat ID and WhatsApp number someone put on their 名片頁, for the other
 * driver on an order. Whether the page is public does not matter here: only the
 * dispatcher and the driver who took the order get these, never the passenger.
 */
function pageContactOf(page: ContactPage) {
  return { wechatId: page?.wechatId || null, whatsapp: page?.whatsapp || null };
}

/**
 * The numbers someone can be reached on, two at most, one for each side of the border: the one
 * they sign in with, then the number from their details for the other side (內地 for someone
 * who signs in with a 港澳 number, 港澳 otherwise).
 */
export function phonesOf(person: { countryCode: string; phone: string; profile: { hkMacauPhone: string | null; mainlandPhone: string | null } | null }) {
  const signIn = `${person.countryCode} ${person.phone}`;
  const otherSide = person.countryCode === '+86' ? person.profile?.hkMacauPhone : person.profile?.mainlandPhone;
  return otherSide && otherSide !== signIn ? [signIn, otherSide] : [signIn];
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
    plateType: profile?.plateType ?? null,
    vehicleType: profile?.vehicleType ?? null,
    seats: profile?.seats ?? null,
    color: profile?.color ?? null,
    phone: `${claimer.countryCode} ${claimer.phone}`,
    phones: phonesOf(claimer),
    hidePlates: profile?.hidePlates ?? false,
    ...pageContactOf(claimer.profilePage),
    photoIds: claimer.profilePage?.photos.map((photo) => photo.id) ?? [],
  };
}

/**
 * When the winning driver may see the passenger's contact: a set number of
 * minutes before pickup, chosen by the dispatcher, or right away (null).
 */
export function contactRevealAt(order: Pick<OrderWithPeople, 'pickupAt' | 'contactRevealMinutes'>): Date | null {
  return order.contactRevealMinutes === null ? null : new Date(order.pickupAt.getTime() - order.contactRevealMinutes * 60_000);
}

/**
 * 行程群: the trip's group as one side may see it. `qrPath` is where that side reads the WeChat
 * QR from. A WeChat QR past its seven days is only told to the dispatcher, who can replace it.
 */
function tripGroupOf(order: OrderWithPeople, qrPath: string, forDispatcher: boolean, now: Date) {
  const group = order.journeyHead?.tripGroup ?? order.tripGroup;
  if (!group) return null;
  const expired = Boolean(group.expiresAt && group.expiresAt <= now);
  if (expired && !forDispatcher) return null;
  return {
    platform: group.platform,
    inviteUrl: group.inviteUrl,
    qrUrl: group.qrMime && !expired ? `${qrPath}?v=${group.updatedAt.getTime()}` : null,
    expiresAt: group.expiresAt?.toISOString() ?? null,
    expired,
  };
}

export function linksOf(order: Pick<OrderWithPeople, 'code' | 'confirmCode'>, baseUrl: string) {
  return { dispatch: `${baseUrl}/o/${order.code}`, passengerConfirm: `${baseUrl}/c/${order.confirmCode}` };
}

/** A 接駁 order's status as a whole: cancelled legs drop out. */
function tripStatus(legs: { status: OrderWithPeople['status'] }[]): OrderWithPeople['status'] {
  const live = legs.filter((leg) => leg.status !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';
  if (live.every((leg) => leg.status === 'COMPLETED')) return 'COMPLETED';
  return live.some((leg) => leg.status === 'OPEN') ? 'OPEN' : 'ASSIGNED';
}

/**
 * 接駁: the order around this leg. Anyone sees where and when each leg runs and the code to
 * claim it by, so the one link in the group offers both legs; `mine` marks the leg this user
 * holds. The dispatcher sees every leg's driver, and the driver of this leg sees the driver of
 * the other, their phone from the time they may see the passenger's contact, so they can tell
 * each other about delays at the 接駁位置.
 */
function journeyOf(order: OrderWithPeople, viewer: Viewer, contactVisible: boolean, userId?: string) {
  const legs = legsOf(order);
  if (!legs || order.legIndex === null) return null;
  return {
    legIndex: order.legIndex,
    legCount: legs.length,
    status: tripStatus(legs),
    origin: legs[0].origin,
    destination: legs[legs.length - 1].destination,
    transferPlaces: transferPlacesOf({ ...order, legIndex: order.legIndex, legCount: legs.length }),
    legs: legs.map((leg) => {
      const driver = viewer !== 'other' && leg.status !== 'CANCELLED' ? driverOf(leg) : null;
      return {
        legIndex: leg.legIndex,
        status: leg.status,
        pickupAt: leg.pickupAt.toISOString(),
        origin: leg.origin,
        destination: leg.destination,
        code: leg.code,
        requiredPlates: leg.requiredPlates,
        driverPrice: driverPriceOf(leg),
        mine: Boolean(userId && leg.claimedById === userId),
        selfDrive: leg.claimedById === order.dispatcherId,
        ...(viewer === 'dispatcher' ? { id: leg.id } : {}),
        ...(viewer !== 'other'
          ? { driver: driver && (contactVisible ? driver : { ...driver, phone: null, phones: [], wechatId: null, whatsapp: null }) }
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
export function toOrderView(order: OrderWithPeople, viewer: Viewer, baseUrl: string, now = new Date(), userId?: string) {
  const participant = viewer !== 'other';
  const revealAt = contactRevealAt(order);
  // The passenger is the dispatcher's customer: once the trip is done or cancelled, the driver
  // no longer gets the passenger's phone or the trip's group.
  const ended = order.status === 'COMPLETED' || order.status === 'CANCELLED';
  // The dispatcher always sees the contact; the driver only from the reveal time until the trip is over.
  const contactVisible = viewer === 'dispatcher' || (!ended && (!revealAt || now >= revealAt));
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
    journey: journeyOf(order, viewer, contactVisible, userId),
    dispatcherName: order.dispatcher.profile?.name ?? null,
    // Before claiming, a driver can look at who put the order out: their 名片頁, when it is public.
    dispatcherPageCode: order.dispatcher.profilePage?.published ? order.dispatcher.profilePage.code : null,
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
          // For the driver: the phone is gone because the trip is over, not because it is too early.
          contactEnded: viewer === 'driver' && ended,
          driver: driverOf(order),
          // Dispatchers publish their number in their group nickname; the winning driver gets it here.
          dispatcherPhone: `${order.dispatcher.countryCode} ${order.dispatcher.phone}`,
          dispatcherContact: { ...pageContactOf(order.dispatcher.profilePage), phones: phonesOf(order.dispatcher) },
          // 已結清: the dispatcher's mark, shown to the driver too. Nothing to settle on 這單我自己做.
          settledAt: isSelfDriven(order) ? null : (order.settledAt?.toISOString() ?? null),
          // 行程群: the passenger is in it, so the driver gets it when they may see the passenger's contact.
          tripGroup:
            contactVisible && order.status !== 'CANCELLED'
              ? tripGroupOf(order, `/api/orders/${order.id}/trip-group/qr`, viewer === 'dispatcher', now)
              : null,
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
          margin: spreadOf(order),
          showPaymentMethods: order.showPaymentMethods,
          paidAt: order.paidAt?.toISOString() ?? null,
          links: linksOf(order, baseUrl),
          // The passenger of a booking already has a link that leads to the confirmation page.
          fromBooking: Boolean(order.booking),
        }
      : {}),
  };
}

function passengerLeg(leg: JourneyLeg, confirmCode: string) {
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
      // The driver may keep their plates from passengers; the page then says to ask before boarding.
      platesHidden: driver.hidePlates,
      hkPlate: driver.hidePlates ? null : driver.hkPlate,
      macauPlate: driver.hidePlates ? null : driver.macauPlate,
      mainlandPlate: driver.hidePlates ? null : driver.mainlandPlate,
      plateType: driver.plateType,
      vehicleType: driver.vehicleType,
      color: driver.color,
      // Once the leg is over the passenger no longer gets the driver's numbers; the person who
      // arranged the trip stays reachable.
      phone: leg.status === 'COMPLETED' ? null : driver.phone,
      phones: leg.status === 'COMPLETED' ? [] : driver.phones,
      // The driver's vehicle photos, so the passenger knows the car; served only through this link.
      photos: driver.photoIds.map((id) => `/api/c/${confirmCode}/driver-photos/${id}`),
    },
  };
}

/**
 * What the passenger sees on the confirmation link. The driver price never
 * appears; the passenger price appears only when the dispatcher chose to show
 * it. For a trip with 接駁, the top-level fields describe the whole trip and
 * `legs` lists every leg that is not cancelled; the trip counts as confirmed
 * only when every such leg is.
 */
export function toPassengerView(order: OrderWithPeople, now = new Date()) {
  const single = passengerLeg(order, order.confirmCode);
  const allLegs = legsOf(order);
  const legs = allLegs?.filter((leg) => leg.status !== 'CANCELLED').map((leg) => passengerLeg(leg, order.confirmCode)) ?? null;
  const shown = legs && legs.length > 0 ? legs : null;
  const confirmed = shown
    ? shown.every((leg) => leg.passengerConfirmedAt)
      ? shown.map((leg) => leg.passengerConfirmedAt as string).sort().at(-1)!
      : null
    : single.passengerConfirmedAt;
  // With one leg left (the others cancelled) the page shows that leg like a single order.
  const lead = shown ? shown[0] : single;
  const status = allLegs ? tripStatus(allLegs) : order.status;
  // 接駁: the passenger is told the car changes on the way and who drives each leg, never where
  // the cars meet: that is between the dispatcher and the two drivers.
  const transfer = Boolean(shown && shown.length > 1);
  return {
    status,
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
    // Who arranged the trip, for questions and changes. The passenger got this link from them,
    // so their phone, WeChat ID and WhatsApp are theirs to give here. Left out while they drive
    // the whole trip themselves: the driver's card already is them. Once that trip is over the
    // driver's card loses its numbers, so they are given here.
    dispatcher:
      !allLegs && isSelfDriven(order) && order.status !== 'COMPLETED'
        ? null
        : {
            name: order.dispatcher.profile?.name ?? null,
            phone: `${order.dispatcher.countryCode} ${order.dispatcher.phone}`,
            phones: phonesOf(order.dispatcher),
            ...pageContactOf(order.dispatcher.profilePage),
          },
    passengerConfirmedAt: confirmed,
    // 行程群: the group the dispatcher made for this trip, when there is one. Not once the trip
    // is over: the driver is in it, and the passenger no longer gets ways to reach the driver.
    tripGroup: status === 'COMPLETED' ? null : tripGroupOf(order, `/api/c/${order.confirmCode}/trip-group/qr`, false, now),
    driver: lead.driver,
    transfer,
    legs: transfer
      ? shown!.map(({ legIndex, status: legStatus, passengerConfirmedAt, driver }) => ({ legIndex, status: legStatus, passengerConfirmedAt, driver }))
      : null,
  };
}
