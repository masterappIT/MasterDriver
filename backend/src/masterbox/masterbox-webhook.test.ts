import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { supportEventOf, verifyMasterBoxSignature, type MasterBoxEvent } from './masterbox-webhook';

const SECRET = 'whsec_test';
const now = Date.parse('2026-11-20T08:00:00Z');
const body = Buffer.from('{"id":"evt_1","type":"message.created"}');
const sign = (t: number, secret = SECRET, raw = body) => createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
const t = now / 1000;

test('a signature made with the secret over the exact body is accepted', () => {
  assert.equal(verifyMasterBoxSignature(body, `t=${t},v1=${sign(t)}`, SECRET, now), true);
});

test('another secret, another body, no signature or an old one is refused', () => {
  assert.equal(verifyMasterBoxSignature(body, `t=${t},v1=${sign(t, 'whsec_other')}`, SECRET, now), false);
  assert.equal(verifyMasterBoxSignature(Buffer.from('{"id":"evt_2"}'), `t=${t},v1=${sign(t)}`, SECRET, now), false);
  assert.equal(verifyMasterBoxSignature(body, undefined, SECRET, now), false);
  assert.equal(verifyMasterBoxSignature(body, `t=${t - 301},v1=${sign(t - 301)}`, SECRET, now), false, 'more than 5 minutes old');
});

test('while the secret is being changed, either of the two signatures will do', () => {
  assert.equal(verifyMasterBoxSignature(body, `t=${t},v1=${sign(t, 'whsec_new')},v1=${sign(t)}`, SECRET, now), true);
});

const created = (sender: string, direction = 'outbound', customer: string | null = 'user1'): MasterBoxEvent => ({
  id: 'evt_1',
  type: 'message.created',
  data: { customer_id: customer, message: { direction: direction as 'outbound', sender: { type: sender as 'agent' }, created_at: '2026-11-20T07:59:00Z' } },
});

test('staff, the API (which sends as staff) and system messages to a driver are replies', () => {
  assert.deepEqual(supportEventOf(created('agent')), { kind: 'reply', userId: 'user1', at: new Date('2026-11-20T07:59:00Z') });
  assert.equal(supportEventOf(created('system'))?.kind, 'reply');
});

test('what the driver sends, and conversations with no customer of ours, are not', () => {
  assert.equal(supportEventOf(created('guest', 'inbound')), null);
  assert.equal(supportEventOf(created('agent', 'outbound', null)), null);
  assert.equal(supportEventOf({ id: 'evt_2', type: 'conversation.created', data: { customer_id: 'user1' } }), null);
  assert.equal(supportEventOf({}), null);
});

test('the driver reading staff messages is a read', () => {
  assert.deepEqual(supportEventOf({ id: 'evt_3', type: 'message.read', data: { customer_id: 'user1' } }), { kind: 'read', userId: 'user1' });
});
