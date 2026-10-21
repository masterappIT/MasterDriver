import type { Money } from './format';

/** A booking request, as the passenger's link and the driver's list both show it. */
export interface Booking {
  code: string;
  /** 特價車: sent from that deal at its price, which is not quoted again. */
  deal: { id: string; code: string } | null;
  status: 'PENDING' | 'QUOTED' | 'ACCEPTED' | 'ORDERED' | 'DECLINED' | 'CANCELLED';
  pickupAt: string;
  origin: string;
  destination: string;
  passengers: number;
  luggage: number;
  /** The passenger asked for 接駁 (中途換車) rather than 直達; the driver sets where the cars change. */
  transfer: boolean;
  /** The passenger asked for 往返 (there and back); returnPickupAt is the way back. */
  roundTrip: boolean;
  returnPickupAt: string | null;
  /** 往返: where the way back leaves from and goes to; null means the way there reversed. */
  returnOrigin: string | null;
  returnDestination: string | null;
  passengerName: string | null;
  passengerContact: string;
  passengerWechat: string | null;
  notes: string | null;
  quote: Money;
  quoteNote: string | null;
  quotedAt: string | null;
  createdAt: string;
}

export interface DriverBooking extends Booking {
  id: string;
  unread: boolean;
  source: string | null;
  orderId: string | null;
}

/** The same request reads differently to each side. */
export const BOOKING_STATUS: Record<Booking['status'], { driver: string; passenger: string }> = {
  PENDING: { driver: '待回覆', passenger: '已送出，等司機回覆' },
  QUOTED: { driver: '已報價，等乘客回覆', passenger: '司機已報價' },
  ACCEPTED: { driver: '乘客已同意', passenger: '你已同意報價，等司機安排' },
  ORDERED: { driver: '已成單', passenger: '司機已安排行程' },
  DECLINED: { driver: '已婉拒', passenger: '司機未能接這個行程' },
  CANCELLED: { driver: '乘客已取消', passenger: '你已取消' },
};

/**
 * A 特價車 booking at the same states: the price was the deal's, and the driver making the order
 * is them accepting this party (docs/DECISIONS.md, 2026-10-21 特價車).
 */
const DEAL_BOOKING_STATUS: Partial<Record<Booking['status'], { driver: string; passenger: string }>> = {
  PENDING: { driver: '特價車預約，等你確認', passenger: '已送出，等司機確認' },
  ACCEPTED: { driver: '已訂到，等你成單', passenger: '你已訂到，等司機安排行程' },
  DECLINED: { driver: '已婉拒', passenger: '司機未能接這個預約' },
};

/** What a request's state reads as to either side, a 特價車 booking in its own words. */
export const bookingStatusText = (booking: Pick<Booking, 'status' | 'deal'>, side: 'driver' | 'passenger') =>
  ((booking.deal && DEAL_BOOKING_STATUS[booking.status]) || BOOKING_STATUS[booking.status])[side];

export const bookingOpen = (status: Booking['status']) => status === 'PENDING' || status === 'QUOTED' || status === 'ACCEPTED';

/** The colour of a booking's state for the driver: gold when it waits on them, blue while the passenger decides, green once it is an order. */
export function bookingTone(status: Booking['status']): 'waiting' | 'passenger' | 'done' | 'closed' {
  if (status === 'PENDING' || status === 'ACCEPTED') return 'waiting';
  if (status === 'QUOTED') return 'passenger';
  return status === 'ORDERED' ? 'done' : 'closed';
}

/** The same states for the passenger: gold when the driver's quote waits on them. */
export function passengerTone(status: Booking['status']): 'waiting' | 'passenger' | 'done' | 'closed' {
  if (status === 'QUOTED') return 'waiting';
  if (status === 'PENDING' || status === 'ACCEPTED') return 'passenger';
  return status === 'ORDERED' ? 'done' : 'closed';
}

/** 往返: the way back's route when it is not the way there reversed; null when it is. */
export function returnRoute(booking: Pick<Booking, 'roundTrip' | 'origin' | 'destination' | 'returnOrigin' | 'returnDestination'>) {
  if (!booking.roundTrip || (!booking.returnOrigin && !booking.returnDestination)) return null;
  const from = booking.returnOrigin ?? booking.destination;
  const to = booking.returnDestination ?? booking.origin;
  return from === booking.destination && to === booking.origin ? null : `${from} 至 ${to}`;
}
