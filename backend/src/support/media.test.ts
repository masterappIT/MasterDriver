import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config';
import { sniffMedia } from './media-file';
import { GcsMediaStorage, LocalMediaStorage, createMediaStorage } from '../storage/media-storage';

const padded = (head: number[] | string) => Buffer.concat([Buffer.from(head as never, 'latin1'), Buffer.alloc(32)]);
const box = (brand: string) => padded(`\0\0\0\x18ftyp${brand}`);

test('a file is what its first bytes say it is', () => {
  assert.equal(sniffMedia(padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime, 'image/png');
  assert.equal(sniffMedia(padded([0xff, 0xd8, 0xff, 0xe0]))?.mime, 'image/jpeg');
  assert.equal(sniffMedia(padded('RIFF\0\0\0\0WEBP'))?.mime, 'image/webp');
  assert.deepEqual([sniffMedia(box('isom'))?.kind, sniffMedia(box('isom'))?.mime], ['VIDEO', 'video/mp4']);
  assert.equal(sniffMedia(box('qt  '))?.mime, 'video/quicktime');
  assert.equal(sniffMedia(padded([0x1a, 0x45, 0xdf, 0xa3]))?.mime, 'video/webm');
});

test('pages, scripts, documents and HEIC pictures are not accepted', () => {
  assert.equal(sniffMedia(padded('<!doctype html><script>')), null);
  assert.equal(sniffMedia(padded('%PDF-1.7')), null);
  assert.equal(sniffMedia(padded('GIF89a')), null);
  assert.equal(sniffMedia(box('heic')), null);
  assert.equal(sniffMedia(Buffer.from('short')), null);
});

test('local storage keeps files under its directory and nowhere else', async () => {
  const storage = new LocalMediaStorage(mkdtempSync(join(tmpdir(), 'md-media-test-')));
  await storage.put('support/c1/m1.jpg', Buffer.from('picture'), 'image/jpeg');
  assert.equal((await storage.read('support/c1/m1.jpg'))?.toString(), 'picture');
  await storage.remove('support/c1/m1.jpg');
  assert.equal(await storage.read('support/c1/m1.jpg'), null);
  await storage.remove('support/c1/m1.jpg');
  await assert.rejects(storage.put('../outside.jpg', Buffer.from('x'), 'image/jpeg'), /Invalid media storage key/);
  await assert.rejects(storage.read('support/../../etc/passwd'), /Invalid media storage key/);
});

test('Cloud Storage: one access token is reused, files go to the bucket with their type, 404 is "not there"', async () => {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const objects = new Map<string, Buffer>();
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.includes('metadata.google.internal')) return Response.json({ access_token: 'token-1', expires_in: 3600 });
    if (method === 'POST') {
      objects.set(decodeURIComponent(new URL(url).searchParams.get('name')!), Buffer.from(init!.body as Uint8Array));
      return Response.json({});
    }
    const key = decodeURIComponent(new URL(url).pathname.split('/o/')[1]);
    if (!objects.has(key)) return new Response('', { status: 404 });
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(new Uint8Array(objects.get(key)!));
  }) as typeof fetch;

  const storage = new GcsMediaStorage('md-support', fake);
  await storage.put('support/c1/m1.mp4', Buffer.from('video'), 'video/mp4');
  assert.equal((await storage.read('support/c1/m1.mp4'))?.toString(), 'video');
  await storage.remove('support/c1/m1.mp4');
  assert.equal(await storage.read('support/c1/m1.mp4'), null);
  await storage.remove('support/c1/m1.mp4');

  assert.equal(calls.filter((call) => call.url.includes('metadata.google.internal')).length, 1);
  const upload = calls.find((call) => call.method === 'POST')!;
  assert.ok(upload.url.startsWith('https://storage.googleapis.com/upload/storage/v1/b/md-support/o?uploadType=media&name=support%2Fc1%2Fm1.mp4'));
  assert.equal(upload.headers.authorization, 'Bearer token-1');
  assert.equal(upload.headers['content-type'], 'video/mp4');
});

test('production uses the bucket, else a named directory, else no media storage; the default directory is never used there', () => {
  assert.equal(createMediaStorage({ isProduction: true, supportMediaBucket: null, supportMediaDir: null }).available, false);
  assert.ok(createMediaStorage({ isProduction: true, supportMediaBucket: 'b', supportMediaDir: null }) instanceof GcsMediaStorage);
  assert.ok(createMediaStorage({ isProduction: true, supportMediaBucket: 'b', supportMediaDir: '/data/media' }) instanceof GcsMediaStorage);
  assert.ok(createMediaStorage({ isProduction: true, supportMediaBucket: null, supportMediaDir: '/data/media' }) instanceof LocalMediaStorage);
  assert.ok(createMediaStorage({ isProduction: false, supportMediaBucket: null, supportMediaDir: '/tmp/x' }) instanceof LocalMediaStorage);
});

test('SUPPORT_MEDIA_DIR is read in production too', () => {
  const env = { NODE_ENV: 'production', OTP_PEPPER: 'x'.repeat(32), DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') };
  assert.equal(loadConfig({ ...env, SUPPORT_MEDIA_DIR: ' /data/media ' }).supportMediaDir, '/data/media');
  assert.equal(loadConfig(env).supportMediaDir, null);
});
