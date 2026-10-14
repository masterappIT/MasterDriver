import { reactive } from 'vue';

/**
 * How the admin asks before an action and says how it went, instead of the browser's prompt() and
 * confirm() and a notice at the top of a long page: a dialog that shows what will happen and takes the
 * reason for the log, and a short message in the corner that is seen wherever the action was.
 */
export interface Ask {
  title: string;
  /** What will happen, in a sentence or two. */
  text: string;
  /** Asks for a reason; it is required unless `reasonOptional`. */
  reason?: string;
  reasonOptional?: boolean;
  confirm: string;
  danger?: boolean;
}

export const dialog = reactive<{ open: Ask | null; reason: string; resolve: ((value: string | null) => void) | null }>({
  open: null,
  reason: '',
  resolve: null,
});

/** Resolves with the reason (an empty string when none was asked), or null when cancelled. */
export function ask(question: Ask): Promise<string | null> {
  dialog.resolve?.(null);
  dialog.open = question;
  dialog.reason = '';
  return new Promise((resolve) => (dialog.resolve = resolve));
}

export function answer(value: string | null) {
  const resolve = dialog.resolve;
  dialog.open = null;
  dialog.resolve = null;
  resolve?.(value);
}

export interface Toast {
  id: number;
  text: string;
  error: boolean;
}

export const toasts = reactive<Toast[]>([]);
let seq = 0;

/** A done message goes by itself after a few seconds; an error stays until closed. */
export function notify(text: string, error = false) {
  const id = (seq += 1);
  toasts.push({ id, text, error });
  if (!error) setTimeout(() => dismiss(id), 4000);
}

export function dismiss(id: number) {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) toasts.splice(index, 1);
}
