import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adCreateSchema, appSettingUpdateSchema, seoSiteUpdateSchema } from './site';

test('links must be https; javascript: and http: are rejected', () => {
  assert.equal(appSettingUpdateSchema.safeParse({ upgradeUrl: 'https://mastertravel.example/demo' }).success, true);
  assert.equal(appSettingUpdateSchema.safeParse({ upgradeUrl: '' }).success, true);
  assert.equal(appSettingUpdateSchema.safeParse({ upgradeUrl: 'javascript:alert(1)' }).success, false);
  assert.equal(appSettingUpdateSchema.safeParse({ upgradeUrl: 'http://insecure.example' }).success, false);
});

test('verification and analytics fields accept plain ids, never markup', () => {
  assert.equal(seoSiteUpdateSchema.safeParse({ googleVerification: 'abc-DEF_123=' }).success, true);
  assert.equal(seoSiteUpdateSchema.safeParse({ baiduTongjiId: '<script>x</script>' }).success, false);
  assert.equal(seoSiteUpdateSchema.safeParse({ canonicalOrigin: 'https://example.com/' }).success, false);
});

test('an ad needs a title and an https link', () => {
  assert.equal(adCreateSchema.safeParse({ position: 'HOME', title: 'x', linkUrl: '' }).success, false);
  const ad = adCreateSchema.parse({ position: 'HOME', title: '自己品牌的系統', linkUrl: 'https://example.com/demo' });
  assert.equal(ad.active, true);
  assert.equal(ad.priority, 0);
});
