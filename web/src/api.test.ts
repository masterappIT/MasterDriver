import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, ApiError, network } from './api';

type Reply = () => Promise<Response>;

/** Answers fetch calls in turn and counts them. */
function serve(replies: Reply[]) {
  const calls: string[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const reply = replies.shift();
    if (!reply) throw new Error('no reply left');
    return reply();
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));
const fail = () => Promise.reject(new TypeError('Failed to fetch'));

test('a read is tried again after a failed connection or a waking server', async () => {
  const calls = serve([fail, json({}, 503), json({ ok: true })]);
  assert.deepEqual(await api('GET', '/public/settings'), { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(network.unstable, false);
});

test('a read that keeps failing gives up with a message and flags the network', async () => {
  const calls = serve([fail, fail, fail]);
  await assert.rejects(api('GET', '/me'), (error: unknown) => error instanceof ApiError && error.code === 'NETWORK_UNSTABLE');
  assert.equal(calls.length, 3);
  assert.equal(network.unstable, true);
  serve([json({ ok: true })]);
  await api('GET', '/me');
  assert.equal(network.unstable, false);
});

test('anything that changes data is sent once, never repeated', async () => {
  const calls = serve([fail]);
  await assert.rejects(api('POST', '/o/x/claim'));
  assert.equal(calls.length, 1);
  serve([json({ code: 'INVALID_ORDER_STATUS' }, 503)]);
  await assert.rejects(api('POST', '/o/x/claim'), (error: unknown) => error instanceof ApiError && error.status === 503);
});

test('the same read while one is out shares it, each with its own copy', async () => {
  const calls = serve([json({ items: [1] })]);
  const [a, b] = await Promise.all([api<{ items: number[] }>('GET', '/orders'), api<{ items: number[] }>('GET', '/orders')]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
});
