import type { Money } from './format';

/** 拼車 (docs/DECISIONS.md, 2026-10-20): a trip a driver opens for passengers to ask for seats on. */
export type CarpoolStatus = 'OPEN' | 'CLOSED' | 'ORDERED' | 'CANCELLED';
export type SeatStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED' | 'REMOVED';

/** What the carpool link and a passenger's own link both say about the trip. */
export interface CarpoolTrip {
  status: CarpoolStatus;
  pickupAt: string;
  origin: string;
  destination: string;
  pickupPoints: string[];
  seats: number;
  left: number;
  minPassengers: number | null;
  /** 還差 N 位成行; zero once it goes. */
  short: number;
  seatPrice: Money;
  luggagePerSeat: number | null;
  cancelPolicy: string | null;
  notes: string | null;
  closesAt: string;
  waitMinutes: number;
}

export interface CarpoolCar {
  name: string | null;
  vehicleType: string | null;
  seats: number | null;
  color: string | null;
  plateType: 'SINGLE' | 'DUAL' | 'TRIPLE' | null;
  platesHidden: boolean;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  completedTrips: number;
  photos: string[];
  pageCode: string | null;
  phones: string[];
  wechatId: string | null;
  whatsapp: string | null;
}

export interface DriverSeat {
  id: string;
  status: SeatStatus;
  passengers: number;
  luggage: number;
  pickupPoint: string;
  dropoff: string;
  passengerName: string;
  passengerContact: string | null;
  passengerWechat: string | null;
  notes: string | null;
  price: Money;
  expiresAt: string | null;
  reconfirm: boolean;
  confirmedAt: string | null;
  cancelledAt: string | null;
  paidAt: string | null;
  createdAt: string;
  unread: boolean;
}

export interface DriverCarpool extends CarpoolTrip {
  id: string;
  code: string;
  url: string;
  autoConfirm: boolean;
  showPaymentMethods: boolean;
  formedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  /** Confirmed passengers who accepted the carpool as it is now. */
  confirmed: number;
  /** Parties waiting for the driver to answer. */
  waiting: number;
  /** Parties yet to accept a changed time or price. */
  unaccepted: number;
  unread: boolean;
  order: { id: string; status: string } | null;
  seatsList: DriverSeat[];
  share: { wechat: string; whatsapp: string };
}

/** How the driver and the passenger read a carpool's state. */
export function carpoolLabel(carpool: Pick<CarpoolTrip, 'status' | 'short'> & { order?: { status: string } | null }): string {
  if (carpool.status === 'CANCELLED') return '已取消';
  if (carpool.status === 'ORDERED') {
    const status = carpool.order?.status;
    if (status === 'COMPLETED') return '已完成';
    if (status === 'CANCELLED') return '已取消';
    return '已成單';
  }
  if (carpool.status === 'CLOSED') return '已截止';
  return carpool.short > 0 ? `招募中，還差 ${carpool.short} 位` : '招募中，已成行';
}

export function carpoolTone(carpool: Pick<CarpoolTrip, 'status' | 'short'>): 'waiting' | 'passenger' | 'done' | 'closed' {
  if (carpool.status === 'CANCELLED') return 'closed';
  if (carpool.status === 'ORDERED') return 'done';
  if (carpool.status === 'CLOSED') return 'passenger';
  return carpool.short > 0 ? 'waiting' : 'passenger';
}

export const SEAT_STATUS: Record<SeatStatus, { driver: string; passenger: string }> = {
  PENDING: { driver: '等你確認', passenger: '等司機確認' },
  CONFIRMED: { driver: '已確認', passenger: '已確認' },
  DECLINED: { driver: '已婉拒', passenger: '司機未能安排' },
  EXPIRED: { driver: '沒有回覆，已失效', passenger: '司機沒有回覆，報位已失效' },
  CANCELLED: { driver: '乘客已取消', passenger: '你已取消' },
  REMOVED: { driver: '你已取消這組', passenger: '司機取消了你的報位' },
};

/** "上車：深圳灣口岸 → 下車：東涌"; the drop-off only when it is not the trip's end. */
export const partyRoute = (party: { pickupPoint: string; dropoff: string }, destination: string) =>
  party.dropoff && party.dropoff !== destination ? `${party.pickupPoint} 上車，${party.dropoff} 下車` : `${party.pickupPoint} 上車`;
