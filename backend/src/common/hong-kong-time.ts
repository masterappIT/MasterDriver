/** Hong Kong, Macau and mainland China all use UTC+8 without daylight saving. */
const OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function shifted(date: Date) {
  return new Date(date.getTime() + OFFSET_MS);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** e.g. "10/15（三）14:30" */
export function formatPickup(date: Date): string {
  const local = shifted(date);
  return `${local.getUTCMonth() + 1}/${local.getUTCDate()}（${WEEKDAYS[local.getUTCDay()]}）${pad(local.getUTCHours())}:${pad(
    local.getUTCMinutes(),
  )}`;
}

/** Calendar month used for monthly quotas, e.g. "2026-10". */
export function monthPeriod(date: Date): string {
  const local = shifted(date);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}`;
}
