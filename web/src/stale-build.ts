import type { Router } from 'vue-router';

/**
 * Each release replaces the whole site, so the previous build's files are gone. A page left open
 * across a release (common inside WeChat) then fails to load the code of the next page it opens.
 * Loading that page afresh gets the new build. At most once in a short while, so a real outage
 * shows its error instead of reloading in a loop.
 */
const KEY = 'md-stale-build-reload';
const RETRY_AFTER_MS = 30_000;

/** The messages browsers give when a lazily loaded page's file is missing. */
export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(message);
}

/** Whether to reload now, given when this tab last reloaded for a new build. */
export function shouldReload(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt > RETRY_AFTER_MS;
}

/** Reloads into `path` (or the current page) when allowed; returns whether it did. */
export function reloadForNewBuild(path?: string): boolean {
  let last: number | null = null;
  try {
    const stored = Number(sessionStorage.getItem(KEY));
    last = Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    // Storage blocked: still reload; the browser's own error shows if it fails again.
  }
  const now = Date.now();
  if (!shouldReload(last, now)) return false;
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // See above.
  }
  if (path) window.location.assign(path);
  else window.location.reload();
  return true;
}

/** Vite reports a failed preload here; a failed page import reaches the router's onError. */
export function reloadOnStaleBuild(router: Router) {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
  router.onError((error, to) => {
    if (isStaleBuildError(error)) reloadForNewBuild(to.fullPath);
  });
}
