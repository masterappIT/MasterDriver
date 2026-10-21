import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSeoTemplate, robotsMeta, robotsTxt } from './seo-rules';

const template = '{司機}｜{路線}｜跨境師傅幫';

test('fills every template variable', () => {
  assert.equal(renderSeoTemplate(template, { 司機: '李師傅', 路線: '深圳灣 ⇄ 香港機場' }), '李師傅｜深圳灣 ⇄ 香港機場｜跨境師傅幫');
});

test('drops a missing value together with its separator', () => {
  assert.equal(renderSeoTemplate(template, { 司機: '李師傅' }), '李師傅｜跨境師傅幫');
  assert.equal(renderSeoTemplate(template, { 路線: '深圳 ⇄ 澳門' }), '深圳 ⇄ 澳門｜跨境師傅幫');
  assert.equal(renderSeoTemplate('{司機} - {車型}', { 司機: '李師傅' }), '李師傅');
});

test('unknown placeholders are removed rather than shown', () => {
  assert.equal(renderSeoTemplate('{電話}｜跨境師傅幫', {}), '跨境師傅幫');
});

test('with indexing off the whole site is closed to crawlers, but link previews still draw', () => {
  const text = robotsTxt({ allowIndexing: false, sitemapEnabled: true, canonicalOrigin: 'https://md.example' });
  assert.ok(text.endsWith('\n\nUser-agent: *\nDisallow: /\n'));
  assert.ok(text.startsWith('User-agent: facebookexternalhit\nUser-agent: Facebot\n'));
  assert.ok(text.includes('User-agent: line-poker\nAllow: /\n'));
  for (const engine of ['Googlebot', 'Baiduspider', 'bingbot']) assert.ok(!text.includes(engine), engine);
  assert.equal(robotsMeta(false), 'noindex, nofollow');
});

test('with indexing on, trip pages, the app, the admin and the API stay closed', () => {
  const text = robotsTxt({ allowIndexing: true, sitemapEnabled: true, canonicalOrigin: 'https://md.example' });
  for (const path of ['/o/', '/c/', '/r/', '/s/', '/d/', '/app', '/admin', '/api/']) assert.ok(text.includes(`Disallow: ${path}\n`), path);
  assert.ok(text.endsWith('Sitemap: https://md.example/sitemap.xml\n'));
  assert.ok(!robotsTxt({ allowIndexing: true, sitemapEnabled: true, canonicalOrigin: '' }).includes('Sitemap'));
});
