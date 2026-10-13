import { ApiError, apiFetch, session } from './api';

/** Same as SUPPORT_* in shared/src/support.ts (not imported, to keep zod out of the bundle). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;

export interface SupportMessage {
  seq: number;
  id: string;
  fromStaff: boolean;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO';
  text: string;
  media: { id: string; mime: string; sizeBytes: number; available: boolean } | null;
  createdAt: string;
}

export interface SupportThread {
  messages: SupportMessage[];
  hasEarlier: boolean;
  uploads: { images: boolean; videos: boolean };
}

const GUEST_KEY = 'md-support-guest';

/** A guest's conversation is reachable only with this token, kept in this browser. */
function guestToken() {
  try {
    return localStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

function rememberGuest(token: string | null) {
  try {
    if (token) localStorage.setItem(GUEST_KEY, token);
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* without storage the guest conversation lasts as long as this page */
  }
  volatileGuest = token;
}
let volatileGuest: string | null = null;

/** Whether there is a conversation to read: every signed-in user has one, a guest only after writing. */
export const hasConversation = () => Boolean(session.user || volatileGuest || guestToken());

async function call(method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit }, write: boolean) {
  const send = async () => {
    const token = session.user ? null : (volatileGuest ?? guestToken());
    return apiFetch(method, `/support${path}`, { ...init, headers: { ...init.headers, ...(token ? { 'x-md-support-guest': token } : {}) } });
  };
  if (!session.user && !(volatileGuest ?? guestToken()) && write) await openGuest();
  try {
    return await send();
  } catch (error) {
    // The stored guest token is no longer known: start a new conversation when writing.
    if (!(error instanceof ApiError) || error.code !== 'SUPPORT_GUEST_REQUIRED' || session.user) throw error;
    rememberGuest(null);
    if (!write) throw error;
    await openGuest();
    return send();
  }
}

async function openGuest() {
  const { token } = (await (await apiFetch('POST', '/support/guest')).json()) as { token: string };
  rememberGuest(token);
}

export async function loadThread(cursor: { after?: number; before?: number } = {}): Promise<SupportThread> {
  if (!hasConversation()) return { messages: [], hasEarlier: false, uploads: { images: true, videos: false } };
  const query = cursor.after !== undefined ? `?after=${cursor.after}` : cursor.before !== undefined ? `?before=${cursor.before}` : '';
  try {
    return (await (await call('GET', `/thread${query}`, {}, false)).json()) as SupportThread;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'SUPPORT_GUEST_REQUIRED') return { messages: [], hasEarlier: false, uploads: { images: true, videos: false } };
    throw error;
  }
}

/** Sending the same id again never posts twice, so a failed send can simply be retried. */
export function newMessageId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sendText(text: string, clientMessageId: string): Promise<SupportMessage> {
  const response = await call('POST', '/messages', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, clientMessageId }) }, true);
  return (await response.json()) as SupportMessage;
}

export async function sendFile(file: Blob, clientMessageId: string): Promise<SupportMessage> {
  const response = await call(
    'POST',
    `/media?clientMessageId=${clientMessageId}`,
    { headers: { 'content-type': file.type || 'application/octet-stream' }, body: file },
    true,
  );
  return (await response.json()) as SupportMessage;
}

/** The file as a local object URL. It is fetched with the sign-in or guest token, never by a plain link. */
export async function mediaUrl(id: string): Promise<string> {
  return URL.createObjectURL(await (await call('GET', `/media/${id}`, {}, false)).blob());
}

const MAX_SIDE = 1920;
const KEEP_AS_IS_BYTES = 1024 * 1024;

/**
 * A picked photo, made small enough to send on mobile data: large photos are
 * scaled down and re-encoded as JPEG (which also drops the location a phone
 * camera writes into the file).
 */
export async function imageForSupport(file: File): Promise<Blob> {
  if (file.size <= KEEP_AS_IS_BYTES && /^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const source = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('canvas');
    return blob;
  } finally {
    URL.revokeObjectURL(source);
  }
}

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;
