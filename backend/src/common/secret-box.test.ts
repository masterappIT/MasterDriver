import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { SecretBox } from './secret-box';

const box = new SecretBox(randomBytes(32).toString('base64'));

test('round-trips a secret and never stores it in the clear', () => {
  const sealed = box.seal('sk_test_1234567890abcdef');
  assert.ok(sealed.startsWith('v1.'));
  assert.ok(!sealed.includes('sk_test'));
  assert.equal(box.open(sealed), 'sk_test_1234567890abcdef');
});

test('the same secret encrypts differently each time', () => {
  assert.notEqual(box.seal('same'), box.seal('same'));
});

test('tampered ciphertext or a different key is rejected', () => {
  const sealed = box.seal('secret');
  const parts = sealed.split('.');
  parts[3] = Buffer.from('other').toString('base64url');
  assert.throws(() => box.open(parts.join('.')));
  assert.throws(() => new SecretBox(randomBytes(32).toString('base64')).open(sealed));
});
