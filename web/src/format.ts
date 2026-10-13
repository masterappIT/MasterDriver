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

export function plates(driver: { hkPlate?: string | null; macauPlate?: string | null; mainlandPlate?: string | null } | null) {
  return driver ? [driver.hkPlate, driver.macauPlate, driver.mainlandPlate].filter(Boolean).join(' / ') : '';
}

export const STATUS_LABEL: Record<string, string> = {
  OPEN: '待搶',
  ASSIGNED: '已派',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const statusText = (status: string, confirmed = false) =>
  t(status === 'ASSIGNED' && confirmed ? '乘客已確認' : (STATUS_LABEL[status] ?? status));
