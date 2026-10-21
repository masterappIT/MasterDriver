import type { CarpoolCar } from './carpool';
import { pickup, type Money } from './format';

/**
 * 特價車 (docs/DECISIONS.md, 2026-10-21 and 2026-10-22): a trip a driver offers at their own price,
 * whole car, for each party; like a product, any number of parties book it, each its own order.
 */
export type DealState = 'OPEN' | 'FULL' | 'CLOSED' | 'CANCELLED' | 'EXPIRED';

/** What the deal link and the driver's page both say about the trip and the price. */
export interface DealTrip {
  state: DealState;
  pickupAt: string;
  /** 時段: the passenger picks a time from pickupAt to this; null: pickupAt exactly. */
  pickupUntil: string | null;
  origin: string;
  destination: string;
  price: NonNullable<Money>;
  originalPrice: Money;
  maxPassengers: number | null;
  maxLuggage: number | null;
  notes: string | null;
}

export interface PublicDeal extends DealTrip {
  code: string;
  autoAccept: boolean;
  driver: CarpoolCar;
}

export interface DealBookingLine {
  id: string;
  status: 'PENDING' | 'QUOTED' | 'ACCEPTED' | 'ORDERED' | 'DECLINED' | 'CANCELLED';
  pickupAt: string;
  passengers: number;
  luggage: number;
  passengerName: string | null;
  unread: boolean;
  orderId: string | null;
  createdAt: string;
}

export interface DriverDeal extends DealTrip {
  id: string;
  code: string;
  url: string;
  autoAccept: boolean;
  /** 最多接幾組; null: no limit. */
  maxBookings: number | null;
  closedAt: string | null;
  cancelledAt: string | null;
  /** Why the platform's staff took it down. */
  staffReason: string | null;
  createdAt: string;
  /** Waiting for the driver to accept. */
  waiting: number;
  /** Booked (自動接受), waiting for their order. */
  toOrder: number;
  ordered: number;
  /** Places left under maxBookings; null: no limit. */
  left: number | null;
  unread: boolean;
  bookings: DealBookingLine[];
  car: { name: string | null; vehicleType: string | null; seats: number | null; photoUrl: string | null };
  share: { wechat: string; whatsapp: string };
}

/** 「10/25（日）16:00」, or the 時段 「10/25（日）14:00–18:00」 (the end's date too when it runs into the next day). */
export function dealTime(deal: Pick<DealTrip, 'pickupAt' | 'pickupUntil'>) {
  const start = pickup(deal.pickupAt);
  if (!deal.pickupUntil) return start;
  const end = pickup(deal.pickupUntil);
  const day = (text: string) => text.slice(0, text.indexOf('）') + 1);
  return day(start) === day(end) ? `${start}–${end.slice(day(end).length)}` : `${start} – ${end}`;
}

/** 「最多 6 人、6 件行李」, or empty. */
export function dealLimits(deal: Pick<DealTrip, 'maxPassengers' | 'maxLuggage'>) {
  const parts = [deal.maxPassengers !== null ? `${deal.maxPassengers} 人` : null, deal.maxLuggage !== null ? `${deal.maxLuggage} 件行李` : null].filter(Boolean);
  return parts.length ? `最多 ${parts.join('、')}` : '';
}

export const DEAL_STATE: Record<DealState, { driver: string; passenger: string; tone: 'waiting' | 'passenger' | 'done' | 'closed' }> = {
  OPEN: { driver: '開放預約', passenger: '可以預約', tone: 'passenger' },
  FULL: { driver: '已接滿', passenger: '已接滿', tone: 'done' },
  CLOSED: { driver: '已關閉', passenger: '已關閉', tone: 'closed' },
  CANCELLED: { driver: '平台已下架', passenger: '已下架', tone: 'closed' },
  EXPIRED: { driver: '已過期', passenger: '已過期', tone: 'closed' },
};
