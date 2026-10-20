import type { SmsRoute } from '../../generated/prisma';

/** One SMS sign-in code as the wait figures need it. */
export interface CodeRow {
  countryCode: string;
  phone: string;
  createdAt: Date;
  consumedAt: Date | null;
}

export interface RouteWait {
  route: SmsRoute;
  /** Sign-ins started: a first code, with any 重新發送 after it. */
  attempts: number;
  signedIn: number;
  /** Started and never signed in: the code may not have arrived, or the driver gave up. */
  notSignedIn: number;
  /** Seconds from the first code of a sign-in to signing in; null when nobody signed in. */
  medianSeconds: number | null;
  p90Seconds: number | null;
  slowestSeconds: number | null;
}

/** A code lives this long, so a sign-in started earlier than this is over. */
const ATTEMPT_MS = 10 * 60 * 1000;

function percentile(sorted: number[], fraction: number) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

/**
 * How long drivers waited for their SMS code. The wait is measured from the first code a sign-in
 * asked for to the moment it signed in, so it includes typing the code: an upper bound on how
 * long the SMS took, and what the driver lived through. A code asked for again (重新發送) belongs
 * to the sign-in it was asked for in.
 */
export function summarizeWaits(rows: CodeRow[], routeOf: (countryCode: string) => SmsRoute, routes: SmsRoute[]): RouteWait[] {
  const byPhone = new Map<string, CodeRow[]>();
  for (const row of rows) {
    const key = `${row.countryCode}:${row.phone}`;
    const list = byPhone.get(key);
    if (list) list.push(row);
    else byPhone.set(key, [row]);
  }

  const tally = new Map<SmsRoute, { attempts: number; waits: number[] }>(routes.map((route) => [route, { attempts: 0, waits: [] }]));
  for (const list of byPhone.values()) {
    const stats = tally.get(routeOf(list[0].countryCode));
    if (!stats) continue;
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let start: Date | null = null;
    let doneAt: Date | null = null;
    for (const row of list) {
      const startsNew =
        start === null || row.createdAt.getTime() - start.getTime() >= ATTEMPT_MS || (doneAt !== null && row.createdAt > doneAt);
      if (startsNew) {
        start = row.createdAt;
        doneAt = null;
        stats.attempts += 1;
      }
      if (row.consumedAt && doneAt === null) {
        doneAt = row.consumedAt;
        stats.waits.push(Math.max(0, Math.round((row.consumedAt.getTime() - start!.getTime()) / 1000)));
      }
    }
  }

  return routes.map((route) => {
    const { attempts, waits } = tally.get(route)!;
    const sorted = [...waits].sort((a, b) => a - b);
    return {
      route,
      attempts,
      signedIn: waits.length,
      notSignedIn: attempts - waits.length,
      medianSeconds: percentile(sorted, 0.5),
      p90Seconds: percentile(sorted, 0.9),
      slowestSeconds: sorted.length ? sorted[sorted.length - 1] : null,
    };
  });
}
