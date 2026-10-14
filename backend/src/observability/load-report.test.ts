import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReportLimiter, loadReportSchema } from './load-report';

test('a load report carries the kind of page, never anything else', () => {
  for (const page of ['/', '/o', '/o/:code', '/legal/:kind(terms|privacy)', '/app/orders/:id/share', '(none)']) {
    assert.equal(loadReportSchema.safeParse({ outcome: 'ready', page, ms: 1200 }).success, true, page);
  }
  assert.equal(loadReportSchema.safeParse({ outcome: 'stalled', page: '/o', ms: 10_000, net: '4g', afterStall: true }).success, true);
  for (const page of ['o/:code', '/o/<script>', '/o?code=1', '/o/ x', 'x'.repeat(81)]) {
    assert.equal(loadReportSchema.safeParse({ outcome: 'ready', page, ms: 1 }).success, false, page);
  }
  assert.equal(loadReportSchema.safeParse({ outcome: 'other', page: '/', ms: 1 }).success, false);
  assert.equal(loadReportSchema.safeParse({ outcome: 'ready', page: '/', ms: -1 }).success, false);
  assert.equal(loadReportSchema.safeParse({ outcome: 'ready', page: '/', ms: 1, net: '4G LTE' }).success, false);
});

test('one address may send only so many reports a minute', () => {
  const allow = createReportLimiter(2);
  assert.equal(allow('a', 0), true);
  assert.equal(allow('a', 1), true);
  assert.equal(allow('a', 2), false);
  assert.equal(allow('b', 2), true);
  assert.equal(allow('a', 60_000), true);
});
