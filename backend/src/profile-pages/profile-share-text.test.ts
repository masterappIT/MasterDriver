import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileShareText } from './profile-share-text';

test('the 名片頁 share text says who the driver is, the car and the link', () => {
  assert.equal(
    profileShareText({ name: '張師傅', vehicleType: '埃爾法', seats: 7, plateType: 'TRIPLE' }, 'https://x.test/p/abc'),
    '【跨境接送】張師傅\n埃爾法｜7座｜三地牌\n要用車直接在這裡約我，不用註冊：https://x.test/p/abc',
  );
});

test('the 名片頁 share text skips what the driver has not filled in', () => {
  assert.equal(
    profileShareText({ name: null, vehicleType: null, seats: null, plateType: null }, 'https://x.test/p/abc'),
    '【跨境接送】司機\n要用車直接在這裡約我，不用註冊：https://x.test/p/abc',
  );
});
