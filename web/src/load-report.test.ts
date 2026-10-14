import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport, pageOf } from './load-report';

test('the page is reported as the route, never its codes', () => {
  assert.equal(pageOf([{ path: '/o/:code' }]), '/o/:code');
  assert.equal(pageOf([{ path: '/app' }, { path: '/app/orders/:id' }]), '/app/orders/:id');
  assert.equal(pageOf([]), '(none)');
});

test('a report keeps to what the server accepts', () => {
  assert.deepEqual(buildReport('ready', '/p/:code', 2345.6, '4g', false), { outcome: 'ready', page: '/p/:code', ms: 2346, net: '4g' });
  assert.deepEqual(buildReport('ready', '/', 10, undefined, true), { outcome: 'ready', page: '/', ms: 10, afterStall: true });
  assert.equal(buildReport('network-failed', '/', 9_000_000, '', false).ms, 3_600_000);
  assert.equal(buildReport('ready', '/', -5, 1, false).net, undefined);
});
