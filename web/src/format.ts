import { t } from './i18n';

export type Money = { amount: number; currency: string } | null | undefined;

const CURRENCY_PREFIX: Record<string, string> = { HKD: 'HK$', CNY: 'RMB¥', MOP: 'MOP$' };
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (value: number) => String(value).padStart(2, '0');

export function money(value: Money): string {
  if (!value) return '';
  return `${CURRENCY_PREFIX[value.currency] ?? value.currency}${value.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Hong Kong, Macau and the mainland all use UTC+8. */
function local(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
}

/** e.g. "10/15（四）14:30" */
export function pickup(iso: string): string {
  const d = local(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()]}）${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function shortTime(iso: string | null): string {
  if (!iso) return '';
  const d = local(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** <input type="datetime-local"> value for a time in Hong Kong. */
export function toLocalInput(date: Date): string {
  return local(date.toISOString()).toISOString().slice(0, 16);
}

export const fromLocalInput = (value: string) => `${value}:00+08:00`;

/** "4人｜3件行李｜7座", as in the group text; no luggage is left unsaid. */
export function loadLine(passengers: number, luggage: number, vehicleType?: string | null): string {
  return [`${passengers}人`, luggage > 0 ? `${luggage}件行李` : null, vehicleType].filter(Boolean).join('｜');
}

const PLATE_KINDS = { SINGLE: '單牌', DUAL: '兩地牌', TRIPLE: '三地牌' } as const;

/**
 * 單牌, 兩地牌 or 三地牌: what kind of cross-border car a driver has, as they said, or counted
 * from the plates for details filled in before that was asked. Shown with the vehicle type and colour.
 */
export function plateKind(
  driver: { plateType?: keyof typeof PLATE_KINDS | null; hkPlate?: string | null; macauPlate?: string | null; mainlandPlate?: string | null } | null | undefined,
): string {
  if (!driver) return '';
  if (driver.plateType) return PLATE_KINDS[driver.plateType];
  const count = [driver.hkPlate, driver.macauPlate, driver.mainlandPlate].filter(Boolean).length;
  return count > 0 ? Object.values(PLATE_KINDS)[count - 1] : '';
}

export const STATUS_LABEL: Record<string, string> = {
  OPEN: '待搶',
  ASSIGNED: '已派',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const statusText = (status: string, confirmed = false) =>
  t(status === 'ASSIGNED' && confirmed ? '乘客已確認' : (STATUS_LABEL[status] ?? status));
