import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStaleBuildError, shouldReload } from './stale-build';

test('recognises a missing page file in Chrome, Safari and Firefox, and nothing else', () => {
  assert.equal(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: https://md.test/assets/MePage-abc.js')), true);
  assert.equal(isStaleBuildError(new TypeError('Importing a module script failed.')), true);
  assert.equal(isStaleBuildError(new TypeError('error loading dynamically imported module: https://md.test/assets/x.js')), true);
  assert.equal(isStaleBuildError(new Error('Unable to preload CSS for /assets/MePage-abc.css')), true);
  assert.equal(isStaleBuildError(new Error('ORDER_NOT_FOUND')), false);
  assert.equal(isStaleBuildError(undefined), false);
});

test('reloads once, then not again for a while, so an outage does not loop', () => {
  const now = 1_000_000;
  assert.equal(shouldReload(null, now), true);
  assert.equal(shouldReload(now - 5_000, now), false);
  assert.equal(shouldReload(now - 31_000, now), true);
});
