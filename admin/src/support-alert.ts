/**
 * The 客服 page's alert: a short two-note chime when someone new is waiting, switched on or off per
 * browser. Rewritten after Master Travel admin/src/utils/support-alert.js (c902bb5a, docs/REUSE.md).
 */
const STORAGE_KEY = 'md-admin-support-sound';
let context: AudioContext | null = null;

export function readAlertSound(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeAlertSound(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Only the default next time is affected.
  }
}

/** Browsers refuse sound until the page has been clicked once; the title and the notice still change. */
export function playAlert() {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const start = context.currentTime;
    for (const [offset, frequency] of [
      [0, 880],
      [0.18, 1175],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.17);
    }
  } catch {
    // The chime failing never gets in the way of answering.
  }
}

interface Waiting {
  id: string;
  lastMessageAt: string | null;
}

/**
 * How many conversations became waiting, or got a newer message, since the last look. The first
 * look only sets the baseline: what was already waiting when the page opened does not chime.
 */
export function incomingTracker() {
  let seen: Map<string, string> | null = null;
  let seenTotal = 0;
  return (items: Waiting[], total: number) => {
    const next = new Map(items.map((item) => [item.id, item.lastMessageAt ?? '']));
    const fresh = seen ? items.filter((item) => (item.lastMessageAt ?? '') > (seen!.get(item.id) ?? '')).length : 0;
    // The waiting list is oldest first, so a new one can sit beyond the first page: the total tells.
    const result = seen ? Math.max(fresh, total - seenTotal) : 0;
    seen = next;
    seenTotal = total;
    return result;
  };
}
