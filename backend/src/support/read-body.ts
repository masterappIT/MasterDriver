import type { Request } from 'express';

/**
 * Reads a raw request body into memory, giving up as soon as it passes
 * `limit` bytes. Returns null when it is too large.
 */
export function readLimited(request: Request, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        // Keep draining so the client gets the answer, but keep nothing.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolvePromise(tooLarge ? null : Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
