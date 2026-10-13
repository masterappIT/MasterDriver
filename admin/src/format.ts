const CURRENCY_PREFIX: Record<string, string> = { HKD: 'HK$', CNY: 'RMB¥', MOP: 'MOP$' };

export function money(value: { amount: number; currency: string } | null | undefined): string {
  if (!value) return '—';
  return `${CURRENCY_PREFIX[value.currency] ?? value.currency}${value.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function hkd(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '—' : money({ amount, currency: 'HKD' });
}

const formatter = new Intl.DateTimeFormat('zh-HK', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function dateTime(iso: string | null | undefined): string {
  return iso ? formatter.format(new Date(iso)) : '—';
}

/** Value for <input type="datetime-local"> in Hong Kong time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const shifted = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (Hong Kong time) to ISO with offset. */
export function fromLocalInput(value: string): string | undefined {
  return value ? `${value}:00+08:00` : undefined;
}

export const PLAN_NAME: Record<string, string> = { free: '個人（免費）', team: '團隊', company: '公司' };

export const ORDER_STATUS: Record<string, string> = {
  OPEN: '待搶',
  ASSIGNED: '已派',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const CREDIT_ENTRY: Record<string, string> = {
  TOPUP: '充值',
  CHARGE: '服務費',
  REFUND: '退回',
  ADJUST: '調整',
};
