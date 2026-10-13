export const MAX_QR_BYTES = 400 * 1024;

const SIGNATURES: { mime: string; test: (bytes: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/**
 * Decodes an uploaded QR image (data URL) and checks that the bytes really are
 * the image type they claim to be and are small enough. Returns null otherwise.
 */
export function decodeQrImage(dataUrl: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_QR_BYTES) return null;
  const actual = SIGNATURES.find((signature) => signature.test(bytes));
  if (!actual || actual.mime !== match[1]) return null;
  // A plain Uint8Array copy is what Prisma stores in a Bytes column.
  return { mime: actual.mime, bytes: new Uint8Array(bytes) };
}
