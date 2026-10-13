/**
 * How long until a pickup, in the words a driver would say: "35 分鐘後", "2 小時 50 分鐘後",
 * "5 小時後", "2 天後". Rounded down, so it never promises more time than there is.
 * Returns null once the time has passed; the absolute time beside it already says when.
 */
export function timeUntil(iso: string, now: Date = new Date()): string | null {
  const minutes = Math.floor((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (Number.isNaN(minutes) || minutes < 0) return null;
  if (minutes < 1) return '即將出發';
  if (minutes < 60) return `${minutes} 分鐘後`;
  const hours = Math.floor(minutes / 60);
  if (hours < 3) {
    const rest = minutes % 60;
    return rest ? `${hours} 小時 ${rest} 分鐘後` : `${hours} 小時後`;
  }
  if (hours < 48) return `${hours} 小時後`;
  return `${Math.floor(hours / 24)} 天後`;
}
