import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSimplified } from './convert';

test('converts interface text and place names to Simplified Chinese', () => {
  assert.equal(toSimplified('搶單成功，請聯絡乘客'), '抢单成功，请联络乘客');
  assert.equal(toSimplified('深圳灣口岸 → 香港國際機場'), '深圳湾口岸 → 香港国际机场');
});

test('leaves numbers, links and Latin text unchanged', () => {
  assert.equal(toSimplified('HK$850 https://x.test/o/AbC'), 'HK$850 https://x.test/o/AbC');
});
