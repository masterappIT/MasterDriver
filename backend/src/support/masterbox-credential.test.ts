import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { MASTERBOX_CREDENTIAL_SECONDS, signMasterBoxCredential } from './masterbox-credential';

const key = { appId: 'app_test', signingSecret: 'mbs_test-secret' };
const now = new Date('2026-11-18T10:00:00Z');
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('a credential is an HS256 JWT with the App ID as kid, the driver as sub, and an hour to live', () => {
  const [header, claims, signature] = signMasterBoxCredential({ id: 'driver1', name: '陳大文' }, key, now).split('.');
  assert.deepEqual(decode(header), { alg: 'HS256', typ: 'JWT', kid: 'app_test' });
  const issuedAt = now.getTime() / 1000;
  assert.deepEqual(decode(claims), { sub: 'driver1', name: '陳大文', iat: issuedAt, exp: issuedAt + MASTERBOX_CREDENTIAL_SECONDS });
  assert.equal(signature, createHmac('sha256', key.signingSecret).update(`${header}.${claims}`).digest('base64url'));
});

test('each part uses only the characters the widget accepts', () => {
  assert.match(signMasterBoxCredential({ id: 'driver1', name: '陳大文' }, key, now), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('a driver without a name is sent without one', () => {
  const claims = decode(signMasterBoxCredential({ id: 'driver1', name: '  ' }, key, now).split('.')[1]);
  assert.equal('name' in claims, false);
});

test('another secret gives another signature', () => {
  const one = signMasterBoxCredential({ id: 'driver1' }, key, now).split('.')[2];
  const other = signMasterBoxCredential({ id: 'driver1' }, { ...key, signingSecret: 'mbs_other' }, now).split('.')[2];
  assert.notEqual(one, other);
});
