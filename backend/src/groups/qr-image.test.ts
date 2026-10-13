import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeQrImage, MAX_QR_BYTES } from './qr-image';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

test('accepts a real PNG', () => {
  assert.equal(decodeQrImage(dataUrl('image/png', png))?.mime, 'image/png');
});

test('rejects bytes that do not match the declared type', () => {
  assert.equal(decodeQrImage(dataUrl('image/jpeg', png)), null);
  assert.equal(decodeQrImage(dataUrl('image/png', Buffer.from('<svg onload=alert(1)>'))), null);
});

test('rejects images over the size limit and other types', () => {
  assert.equal(decodeQrImage(dataUrl('image/png', Buffer.concat([png, Buffer.alloc(MAX_QR_BYTES)]))), null);
  assert.equal(decodeQrImage('data:image/svg+xml;base64,PHN2Zz4='), null);
});
