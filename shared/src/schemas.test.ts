import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOrderSchema, driverProfileSchema, otpRequestSchema } from './schemas';
import { defaultLocaleFor, isValidMobile } from './phone';

test('accepts Hong Kong, mainland and Macau mobile numbers', () => {
  assert.equal(isValidMobile('+852', '91234567'), true);
  assert.equal(isValidMobile('+86', '13812345678'), true);
  assert.equal(isValidMobile('+853', '61234567'), true);
});

test('rejects landlines and wrong lengths', () => {
  assert.equal(isValidMobile('+852', '21234567'), false);
  assert.equal(isValidMobile('+86', '1381234567'), false);
  assert.equal(isValidMobile('+853', '28123456'), false);
});

test('normalizes spaces and dashes before validating a sign-in number', () => {
  const parsed = otpRequestSchema.parse({ countryCode: '+852', phone: '9123 4567' });
  assert.equal(parsed.phone, '91234567');
  assert.equal(otpRequestSchema.safeParse({ countryCode: '+86', phone: '123' }).success, false);
});

test('defaults mainland numbers to Simplified Chinese', () => {
  assert.equal(defaultLocaleFor('+86'), 'zh-Hans');
  assert.equal(defaultLocaleFor('+852'), 'zh-Hant');
});

test('order input fills defaults and drops blank optional text', () => {
  const parsed = createOrderSchema.parse({
    pickupAt: '2026-10-15T14:30:00+08:00',
    origin: ' 深圳灣口岸 ',
    destination: '香港國際機場',
    passengers: 4,
    notes: '   ',
    passengerContact: '+852 9123 4567',
  });
  assert.equal(parsed.origin, '深圳灣口岸');
  assert.deepEqual(parsed.waypoints, []);
  assert.equal(parsed.luggage, 0);
  assert.equal(parsed.notes, undefined);
});

test('an order still needs passengers and the passenger contact', () => {
  assert.equal(createOrderSchema.safeParse({ pickupAt: '2026-10-15T14:30:00+08:00', origin: '澳门', destination: '惠州博罗湾' }).success, false);
});

test('order input requires a time zone on the pickup time', () => {
  const result = createOrderSchema.safeParse({
    pickupAt: '2026-10-15T14:30:00',
    origin: 'A',
    destination: 'B',
    passengers: 1,
    passengerContact: 'x',
  });
  assert.equal(result.success, false);
});

test('plates are stored in upper case', () => {
  const parsed = driverProfileSchema.parse({ name: '李師傅', hkPlate: 'ab1234', mainlandPlate: '粤z1234港' });
  assert.equal(parsed.hkPlate, 'AB1234');
  assert.equal(parsed.mainlandPlate, '粤Z1234港');
});
