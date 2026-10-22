/**
 * 包車 (按小時計費, 2026-10-23): the passenger has the car and driver for a number of hours, at
 * prices an hour the dispatcher sets. The totals are only those prices times the hours; overtime
 * and costs on the way are rules the dispatcher states, never worked out or collected by the
 * platform (docs/DECISIONS.md). No dependencies, so the web app can use it without zod.
 */

/** Hours booked: one day at most (several days are an order a day), by half hours. */
export const CHARTER_MIN_MINUTES = 60;
export const CHARTER_MAX_MINUTES = 24 * 60;
export const CHARTER_STEP_MINUTES = 30;

/** 超時: counted by every 30 minutes or every hour. */
export const OVERTIME_UNITS = [30, 60] as const;
export type OvertimeUnit = (typeof OVERTIME_UNITS)[number];
export const DEFAULT_OVERTIME_UNIT: OvertimeUnit = 30;
/** 超時: this many minutes past the hours booked are not counted. */
export const DEFAULT_OVERTIME_GRACE = 15;
export const MAX_OVERTIME_GRACE = 60;

/** 另計: costs on the way the passenger pays besides the hours. */
export const CHARTER_EXTRAS = ['TOLLS', 'PARKING', 'MEALS'] as const;
export type CharterExtra = (typeof CHARTER_EXTRAS)[number];
export const CHARTER_EXTRA_NAMES: Record<CharterExtra, string> = { TOLLS: '路橋費', PARKING: '停車費', MEALS: '司機膳食' };

/** "8 小時", "8.5 小時". */
export function charterHours(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小時`;
}

/** An hourly price times the hours, in minor units (cents). */
export function charterTotalMinor(hourlyMinor: number, minutes: number): number {
  return Math.round((hourlyMinor * minutes) / 60);
}

/** How 超時 is counted: "每 30 分鐘計，15 分鐘內不計", or "按每小時計". */
export function overtimeCount(unitMinutes: number, graceMinutes: number): string {
  const unit = unitMinutes === 60 ? '按每小時計' : `每 ${unitMinutes} 分鐘計`;
  return graceMinutes > 0 ? `${unit}，${graceMinutes} 分鐘內不計` : unit;
}

/** "超時每 30 分鐘計，15 分鐘內不計", or "超時按每小時計". */
export function overtimeRule(unitMinutes: number, graceMinutes: number): string {
  return `超時${overtimeCount(unitMinutes, graceMinutes)}`;
}

/** "路橋費、停車費另計"; null when nothing is extra. */
export function charterExtrasLine(extras: readonly CharterExtra[]): string | null {
  if (extras.length === 0) return null;
  return `${CHARTER_EXTRAS.filter((extra) => extras.includes(extra))
    .map((extra) => CHARTER_EXTRA_NAMES[extra])
    .join('、')}另計`;
}
