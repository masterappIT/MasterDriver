import { z } from 'zod';

/**
 * How opening a page went, as the phone saw it (web/src/load-report.ts). Requests that never reach
 * the server are missing from its own counts; these reports show where pages stall. Only the kind
 * of page comes in (/o/:code or /o, never a code); the server adds the area and the browser.
 */
export const loadReportSchema = z.object({
  outcome: z.enum(['ready', 'stalled', 'network-failed']),
  page: z.string().regex(/^(\/[A-Za-z0-9:()|_.*-]*)+$|^\(none\)$/).max(80),
  ms: z.number().int().min(0).max(3_600_000),
  net: z.string().regex(/^[a-z0-9-]+$/).max(16).optional(),
  afterStall: z.boolean().optional(),
});

export type LoadReport = z.infer<typeof loadReportSchema>;

/** Reports one address may send a minute on one instance; a page sends one or two. */
export const REPORTS_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

/** Counts reports per address in one-minute windows, so a script cannot fill the logs. */
export function createReportLimiter(limit = REPORTS_PER_MINUTE) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (address: string, now = Date.now()): boolean => {
    // Old windows go once the map grows; a few thousand addresses take little memory.
    if (windows.size > 5_000) {
      for (const [key, window] of windows) if (now - window.startedAt >= MINUTE_MS) windows.delete(key);
    }
    const window = windows.get(address);
    if (!window || now - window.startedAt >= MINUTE_MS) {
      windows.set(address, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= limit;
  };
}
