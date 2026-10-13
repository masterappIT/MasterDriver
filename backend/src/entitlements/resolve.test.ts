import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResolveInput, resolveEntitlement } from './resolve';

const now = new Date('2026-10-15T06:00:00Z');
const past = new Date('2026-10-01T00:00:00Z');
const future = new Date('2026-12-01T00:00:00Z');

const base: ResolveInput = {
  featureKey: 'order.create',
  now,
  plans: {
    free: { 'order.create': { enabled: true, quota: 50 } },
    team: { 'order.create': { enabled: true, quota: 500 }, 'team.manage': { enabled: true, quota: null } },
    company: { 'order.create': { enabled: true, quota: null }, 'team.manage': { enabled: true, quota: null } },
  },
  defaultPlanKey: 'free',
  overrides: [],
  policies: [],
  subscriptionPlanKeys: [],
};

test('falls back to the default plan', () => {
  assert.deepEqual(resolveEntitlement(base), { enabled: true, quota: 50, source: 'default' });
});

test('a feature missing from every plan is disabled', () => {
  assert.equal(resolveEntitlement({ ...base, featureKey: 'team.manage' }).enabled, false);
});

test('the launch free period grants the company plan to everyone', () => {
  const result = resolveEntitlement({
    ...base,
    policies: [{ planKey: 'company', startsAt: past, endsAt: null, active: true }],
  });
  assert.deepEqual(result, { enabled: true, quota: null, source: 'plan-policy' });
});

test('an ended or switched-off free period no longer applies', () => {
  const ended = resolveEntitlement({ ...base, policies: [{ planKey: 'company', startsAt: past, endsAt: past, active: true }] });
  const off = resolveEntitlement({ ...base, policies: [{ planKey: 'company', startsAt: past, active: false }] });
  assert.equal(ended.source, 'default');
  assert.equal(off.source, 'default');
});

test('a paying subscriber keeps the better plan during a weaker free period', () => {
  const result = resolveEntitlement({
    ...base,
    policies: [{ planKey: 'team', startsAt: past, active: true }],
    subscriptionPlanKeys: ['company'],
  });
  assert.deepEqual(result, { enabled: true, quota: null, source: 'subscription' });
});

test('a single-feature free policy unlocks that feature without limit', () => {
  const result = resolveEntitlement({
    ...base,
    featureKey: 'team.manage',
    policies: [{ featureKey: 'team.manage', startsAt: past, active: true }],
  });
  assert.deepEqual(result, { enabled: true, quota: null, source: 'feature-policy' });
});

test('a per-user feature override wins, even when it restricts', () => {
  const result = resolveEntitlement({
    ...base,
    policies: [{ planKey: 'company', startsAt: past, active: true }],
    overrides: [{ featureKey: 'order.create', enabled: false, startsAt: past }],
  });
  assert.deepEqual(result, { enabled: false, quota: null, source: 'override' });
});

test('a per-user plan gift applies only inside its window', () => {
  const gift = { planKey: 'company', startsAt: past, endsAt: future };
  assert.equal(resolveEntitlement({ ...base, overrides: [gift] }).quota, null);
  assert.equal(resolveEntitlement({ ...base, overrides: [{ ...gift, startsAt: future }] }).quota, 50);
});
