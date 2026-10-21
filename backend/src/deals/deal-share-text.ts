import { formatPickup } from '../common/hong-kong-time';
import { formatPrice } from '../orders/share-text';

type Currency = 'HKD' | 'CNY' | 'MOP';

export interface ShareDeal {
  pickupAt: Date;
  pickupUntil: Date | null;
  origin: string;
  destination: string;
  priceMinor: number;
  currency: Currency;
  originalPriceMinor: number | null;
  maxPassengers: number | null;
  maxLuggage: number | null;
  notes: string | null;
}

export interface ShareDealDriver {
  name: string | null;
  vehicleType: string | null;
  seats: number | null;
}

/**
 * When the deal leaves: 「10/25（六）16:00」, or its 時段 「10/25（六）14:00–18:00」, with the end's
 * date too when the 時段 runs into the next day.
 */
export function formatDealTime(deal: Pick<ShareDeal, 'pickupAt' | 'pickupUntil'>) {
  const start = formatPickup(deal.pickupAt);
  if (!deal.pickupUntil) return start;
  const end = formatPickup(deal.pickupUntil);
  const day = (text: string) => text.slice(0, text.indexOf('）') + 1);
  return day(start) === day(end) ? `${start}–${end.slice(day(end).length)}` : `${start} – ${end}`;
}

/** 「整車 RMB¥350（原價 RMB¥500）」 */
export function dealPriceText(deal: Pick<ShareDeal, 'priceMinor' | 'currency' | 'originalPriceMinor'>) {
  const price = `整車 ${formatPrice(deal.priceMinor, deal.currency)}`;
  return deal.originalPriceMinor !== null ? `${price}（原價 ${formatPrice(deal.originalPriceMinor, deal.currency)}）` : price;
}

/**
 * What the driver sends with the deal link: when, where, the car and the price, and that booking
 * needs no account. It must read on its own, since WeChat usually shows the link bare.
 */
export function dealShareText(deal: ShareDeal, driver: ShareDealDriver, url: string) {
  const heading = `【特價車】${formatDealTime(deal)} ${deal.origin} → ${deal.destination}`;
  const seats = driver.seats && !driver.vehicleType?.includes(`${driver.seats}座`) ? `${driver.seats}座` : null;
  const car = [driver.vehicleType, seats].filter(Boolean).join('・');
  const limits = [deal.maxPassengers !== null ? `${deal.maxPassengers} 人` : null, deal.maxLuggage !== null ? `${deal.maxLuggage} 件行李` : null].filter(Boolean);
  const body = [
    [car || null, dealPriceText(deal)].filter(Boolean).join('｜'),
    limits.length ? `最多 ${limits.join('、')}` : null,
    deal.pickupUntil ? '時段內任選出發時間' : null,
    deal.notes ? `備註：${deal.notes}` : null,
    `${driver.name ? `${driver.name}的特價車，` : ''}點開預約，不用註冊：${url}`,
  ].filter((line): line is string => line !== null);
  return { wechat: [heading, ...body].join('\n'), whatsapp: [`*${heading}*`, ...body].join('\n') };
}
