import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeWaits, type CodeRow } from './otp-wait';
import { routeFor } from './sms253';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 20, 4, 0, 0) + seconds * 1000);
const row = (phone: string, created: number, consumed: number | null = null, countryCode = '+86'): CodeRow => ({
  countryCode,
  phone,
  createdAt: at(created),
  consumedAt: consumed === null ? null : at(consumed),
});
const summarize = (rows: CodeRow[]) => summarizeWaits(rows, routeFor, ['DOMESTIC', 'INTERNATIONAL']);

test('a sign-in waits from its first code, even when it signs in with one asked for again', () => {
  // Rows come in any order; the code typed was the second of three.
  const [domestic] = summarize([row('a', 61), row('a', 30, 75), row('a', 0)]);
  assert.equal(domestic.attempts, 1);
  assert.equal(domestic.signedIn, 1);
  assert.equal(domestic.medianSeconds, 75);
});

test('a sign-in with no code used counts as not signed in, and a later one starts afresh', () => {
  const [domestic] = summarize([row('a', 0), row('a', 61), row('a', 700, 760)]);
  assert.equal(domestic.attempts, 2);
  assert.equal(domestic.signedIn, 1);
  assert.equal(domestic.notSignedIn, 1);
  assert.equal(domestic.medianSeconds, 60);
});

test('a code asked for after signing in starts the next sign-in', () => {
  const [domestic] = summarize([row('a', 0, 20), row('a', 120, 150)]);
  assert.equal(domestic.attempts, 2);
  assert.deepEqual([domestic.medianSeconds, domestic.slowestSeconds], [20, 30]);
});

test('figures are per route, with the median, the slowest tenth and the slowest', () => {
  const rows = Array.from({ length: 10 }, (_, index) => row(`p${index}`, 0, (index + 1) * 10));
  rows.push(row('hk', 0, 5, '+852'));
  const [domestic, international] = summarize(rows);
  assert.deepEqual(
    [domestic.attempts, domestic.medianSeconds, domestic.p90Seconds, domestic.slowestSeconds],
    [10, 50, 90, 100],
  );
  assert.deepEqual([international.attempts, international.medianSeconds], [1, 5]);
});

test('no sign-ins give no times', () => {
  const [domestic] = summarize([]);
  assert.deepEqual(domestic, { route: 'DOMESTIC', attempts: 0, signedIn: 0, notSignedIn: 0, medianSeconds: null, p90Seconds: null, slowestSeconds: null });
});
