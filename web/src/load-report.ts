/**
 * Tells the server how opening a page went, as the phone saw it: requests that never reached the
 * server are missing from its own logs, and those are the ones that leave a page loading forever.
 * Only the kind of page is sent (/o/:code, never the order's code), how long it took and what the
 * browser says about its connection; the server adds the area and the browser (WeChat or not).
 * Sending is best effort and never shows an error.
 */

export type LoadOutcome = 'ready' | 'stalled' | 'network-failed';

export interface LoadReport {
  outcome: LoadOutcome;
  page: string;
  /** Milliseconds since the page was opened. */
  ms: number;
  /** The connection type the browser reports (4g, 3g…), where it does. */
  net?: string;
  /** This opening came after one that stalled in the same tab. */
  afterStall?: boolean;
}

/** Set by the loading screen in index.html when the app has not appeared in time. */
export const STALL_KEY = 'md-load-stalled';

/** The route as written, so no order, page or booking code is ever sent. */
export function pageOf(matched: { path: string }[]): string {
  return matched.length > 0 ? matched[matched.length - 1].path || '/' : '(none)';
}

export function buildReport(outcome: LoadOutcome, page: string, ms: number, net: unknown, afterStall: boolean): LoadReport {
  return {
    outcome,
    page: page.slice(0, 80),
    ms: Math.min(3_600_000, Math.max(0, Math.round(ms))),
    ...(typeof net === 'string' && net ? { net: net.slice(0, 16) } : {}),
    ...(afterStall ? { afterStall: true } : {}),
  };
}

function connectionType(): unknown {
  return (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
}

/** Whether the loading screen recorded a stall in this tab. */
function stalledBefore(): boolean {
  try {
    return sessionStorage.getItem(STALL_KEY) !== null;
  } catch {
    return false;
  }
}

/** Kept until a report saying so has reached the server: the stall may still be going on. */
function forgetStall() {
  try {
    sessionStorage.removeItem(STALL_KEY);
  } catch {
    // Nothing kept.
  }
}

export function reportLoad(outcome: LoadOutcome, matched: { path: string }[]) {
  const report = buildReport(outcome, pageOf(matched), performance.now(), connectionType(), outcome === 'ready' && stalledBefore());
  try {
    void fetch('/api/public/load-report', {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    })
      .then((response) => {
        if (response.ok && report.afterStall) forgetStall();
      })
      .catch(() => undefined);
  } catch {
    // A browser that refuses the request outright: nothing to report.
  }
}
