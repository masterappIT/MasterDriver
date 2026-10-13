import { SUPPORT_IMAGE_MAX_BYTES, SUPPORT_VIDEO_MAX_BYTES } from '@masterdriver/shared';

export interface MediaType {
  kind: 'IMAGE' | 'VIDEO';
  mime: string;
  extension: string;
  maxBytes: number;
}

const image = (mime: string, extension: string): MediaType => ({ kind: 'IMAGE', mime, extension, maxBytes: SUPPORT_IMAGE_MAX_BYTES });
const video = (mime: string, extension: string): MediaType => ({ kind: 'VIDEO', mime, extension, maxBytes: SUPPORT_VIDEO_MAX_BYTES });

const ascii = (bytes: Buffer, start: number, end: number) => bytes.subarray(start, end).toString('latin1');

/**
 * What an uploaded file really is, read from its first bytes: the type the
 * sender claims is never trusted. Null for anything other than the pictures
 * and videos 客服 accepts (PNG, JPEG, WebP; MP4, MOV, WebM).
 */
export function sniffMedia(bytes: Buffer): MediaType | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return image('image/png', 'png');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return image('image/jpeg', 'jpg');
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return image('image/webp', 'webp');
  // ISO base media (MP4 and QuickTime): a box named "ftyp" comes first, then its brand.
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    // HEIC and AVIF pictures use the same container; they are not accepted.
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return null;
    return brand === 'qt  ' ? video('video/quicktime', 'mov') : video('video/mp4', 'mp4');
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return video('video/webm', 'webm');
  return null;
}

/** The largest upload the API reads before it knows what the file is. */
export const UPLOAD_MAX_BYTES = Math.max(SUPPORT_IMAGE_MAX_BYTES, SUPPORT_VIDEO_MAX_BYTES);
