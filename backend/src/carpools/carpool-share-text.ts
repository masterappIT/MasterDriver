import { formatPickup } from '../common/hong-kong-time';
import { formatPrice } from '../orders/share-text';

export interface InviteCarpool {
  pickupAt: Date;
  origin: string;
  destination: string;
  pickupPoints: string[];
  seatPriceMinor: number | null;
  seatCurrency: 'HKD' | 'CNY' | 'MOP';
  luggagePerSeat: number | null;
  notes: string | null;
  /** Seats not yet held. */
  left: number;
  /** 還差 N 位成行. */
  short: number;
}

/**
 * What the driver sends passengers with the carpool link: the trip, the price a seat, and how
 * many seats are left. It must read on its own, since WeChat usually shows the link bare.
 */
export function carpoolInviteText(carpool: InviteCarpool, url: string) {
  const heading = `【拼車】${formatPickup(carpool.pickupAt)} ${carpool.origin} → ${carpool.destination}`;
  const terms = [
    carpool.seatPriceMinor !== null ? `每位 ${formatPrice(carpool.seatPriceMinor, carpool.seatCurrency)}` : '每位價錢請私訊',
    carpool.luggagePerSeat !== null ? `每位 ${carpool.luggagePerSeat} 件行李` : null,
  ].filter((part): part is string => part !== null);
  const seats = carpool.left === 0 ? '已滿' : carpool.short > 0 ? `還差 ${carpool.short} 位成行，剩 ${carpool.left} 位` : `剩 ${carpool.left} 位`;
  const body = [
    carpool.pickupPoints.length > 0 ? `上車點：${carpool.pickupPoints.join('、')}` : null,
    terms.join('｜'),
    seats,
    carpool.notes ? `備註：${carpool.notes}` : null,
    `報位：${url}`,
  ].filter((line): line is string => line !== null);
  return { wechat: [heading, ...body].join('\n'), whatsapp: [`*${heading}*`, ...body].join('\n') };
}
