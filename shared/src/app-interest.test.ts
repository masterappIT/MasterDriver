import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validAppInterest } from './app-interest';
import { appInterestAnswerSchema } from './site';

test('網頁就夠 stands alone; the others go together, each once', () => {
  assert.equal(validAppInterest(['MINIPROGRAM', 'IOS_APP', 'ANDROID_APP']), true);
  assert.equal(validAppInterest(['WEB_ENOUGH']), true);
  assert.equal(validAppInterest(['WEB_ENOUGH', 'IOS_APP']), false);
  assert.equal(validAppInterest(['IOS_APP', 'IOS_APP']), false);
  assert.equal(validAppInterest([]), false);
});

test('an answer is choices with an optional note, or skipped with nothing else', () => {
  assert.deepEqual(appInterestAnswerSchema.parse({ skipped: false, choices: ['MINIPROGRAM'] }), { skipped: false, choices: ['MINIPROGRAM'], note: '' });
  assert.deepEqual(appInterestAnswerSchema.parse({ skipped: false, choices: ['IOS_APP'], note: '  推播新單  ' }).note, '推播新單');
  assert.deepEqual(appInterestAnswerSchema.parse({ skipped: true, choices: ['IOS_APP'] }), { skipped: true });
  assert.equal(appInterestAnswerSchema.safeParse({ skipped: false, choices: [] }).success, false);
  assert.equal(appInterestAnswerSchema.safeParse({ skipped: false, choices: ['APP'] }).success, false);
  assert.equal(appInterestAnswerSchema.safeParse({ skipped: false, choices: ['IOS_APP'], note: '字'.repeat(201) }).success, false);
});
