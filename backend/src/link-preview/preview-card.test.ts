import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { CARD_HEIGHT, CARD_WIDTH, PHOTO_WIDTH, cardSvg, fit, previewHtml, type CardData } from './preview-card';

const card: CardData = {
  kind: 'profile',
  name: '陳師傅',
  routes: ['深圳灣 往返 香港機場', '皇崗 往返 東莞'],
  vehicle: '7座商務車 · 兩地牌',
  completedTrips: 128,
  photo: null,
};

test('the preview page escapes what drivers typed', () => {
  const html = previewHtml({ title: '陳師傅"><script>x</script>', description: 'a & b', url: 'https://md.test/p/abcd', image: 'https://md.test/i.jpg' });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  assert.ok(html.includes('content="a &amp; b"'));
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow" />'));
});

test('a 名片頁 card shows the routes; a confirmation card never does, nor a next step on a 名片頁', () => {
  const profile = cardSvg(card);
  assert.ok(profile.includes('司機名片'));
  assert.ok(profile.includes('深圳灣 往返 香港機場'));
  assert.ok(!profile.includes('點開連結'));

  const confirm = cardSvg({ ...card, kind: 'confirm' });
  assert.ok(confirm.includes('為你安排的行程'));
  assert.ok(!confirm.includes('深圳灣 往返 香港機場'), 'the driver’s usual routes would read as this trip’s');
  assert.ok(confirm.includes('點開連結，確認時間與上車地點'));
});

test('a card without a photo draws the first character of the name; text in it is escaped', () => {
  const svg = cardSvg({ ...card, name: '<陳>師傅' });
  assert.ok(svg.includes('>&lt;</text>'), 'the initial');
  assert.ok(!svg.includes('<陳>'));
});

test('a long line is cut with an ellipsis', () => {
  assert.equal(fit('短', 30, 500), '短');
  const long = fit('香港國際機場客運大樓 往返 廣州白雲國際機場二號航站樓', 30, 300);
  assert.ok(long.endsWith('…'));
  assert.ok(long.length < 20);
});

test('a card with a photo renders to a 1200 × 630 JPEG', async () => {
  const photo = await sharp({ create: { width: PHOTO_WIDTH, height: CARD_HEIGHT, channels: 3, background: '#6d7887' } }).jpeg().toBuffer();
  const jpeg = await sharp(Buffer.from(cardSvg({ ...card, photo: `data:image/jpeg;base64,${photo.toString('base64')}` })))
    .jpeg()
    .toBuffer();
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.width, CARD_WIDTH);
  assert.equal(meta.height, CARD_HEIGHT);
  assert.equal(meta.format, 'jpeg');
});

test('a confirmation card counts trips arranged and says who answers for it; a 名片頁 card counts trips driven', () => {
  const profile = cardSvg(card);
  assert.ok(profile.includes('已在師傅幫完成 128 張'));
  assert.ok(!profile.includes('負責'));

  const confirm = cardSvg({ ...card, kind: 'confirm', owner: { line: '行程由陳師傅負責，有問題請找陳師傅', next: '下次用車，可直接在陳師傅的名片頁約' } });
  assert.ok(confirm.includes('已在師傅幫安排 128 趟'));
  assert.ok(confirm.includes('行程由陳師傅負責，有問題請找陳師傅'));
  assert.ok(confirm.includes('下次用車，可直接在陳師傅的名片頁約'));

  const noPage = cardSvg({ ...card, kind: 'confirm', owner: { line: '行程由陳師傅負責，有問題請找陳師傅', next: null } });
  assert.ok(!noPage.includes('名片頁約'));
});
