import type { Money } from './format';

/** A booking request, as the passenger's link and the driver's list both show it. */
export interface Booking {
  code: string;
  status: 'PENDING' | 'QUOTED' | 'ACCEPTED' | 'ORDERED' | 'DECLINED' | 'CANCELLED';
  pickupAt: string;
  origin: string;
  destination: string;
  passengers: number;
  luggage: number;
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
