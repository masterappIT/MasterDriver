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

test('the passenger contact is a phone with its country code, stored in one format', () => {
  const order = { pickupAt: '2026-10-15T14:30:00+08:00', origin: 'A', destination: 'B', passengers: 1 };
  const contact = (passengerContact: string) => createOrderSchema.safeParse({ ...order, passengerContact });
  const stored = (passengerContact: string) => {
    const result = contact(passengerContact);
    return result.success ? result.data.passengerContact : null;
  };
  assert.equal(stored('+852 9123 4567'), '+852 91234567');
  assert.equal(stored('+852 2345-6789'), '+852 23456789', 'a Hong Kong landline is a phone too');
  assert.equal(stored('+86 138 0013 8000'), '+86 13800138000');
  assert.equal(stored('+853 6612 3456'), '+853 66123456');
  for (const rejected of ['wechat: wang-test', 'wang_test', '91234567', '13800138000', '+852 9123', '+86 2345 6789', '+1 4155550172']) {
    const result = contact(rejected);
    assert.equal(result.success, false, rejected);
    if (!result.success) assert.equal(result.error.issues[0].message, 'INVALID_PASSENGER_PHONE', rejected);
  }
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

const driver = { name: '李師傅', vehicleOwnership: 'HK', plateType: 'DUAL', vehicleType: '埃爾法' };

test('plates are stored in upper case and in one format', () => {
  const parsed = driverProfileSchema.parse({ ...driver, hkPlate: 'ab1234', mainlandPlate: '粤z1234港' });
  assert.equal(parsed.hkPlate, 'AB1234');
  assert.equal(parsed.mainlandPlate, '粵Z·1234港');
});

test('a driver profile needs the plates its plate type carries, and a 車型', () => {
  const codes = (input: object) => {
    const result = driverProfileSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };
  assert.deepEqual(codes({ ...driver, hkPlate: 'AB1234' }), ['PLATE_REQUIRED']);
  assert.deepEqual(codes({ ...driver, plateType: 'SINGLE', hkPlate: 'AB1234' }), []);
  assert.deepEqual(codes({ ...driver, vehicleOwnership: 'MAINLAND', plateType: 'TRIPLE', hkPlate: 'AB1234', mainlandPlate: 'B12345' }), [
    'PLATE_TYPE_NOT_ALLOWED',
  ]);
  assert.equal(driverProfileSchema.safeParse({ ...driver, plateType: 'SINGLE', hkPlate: 'AB1234', vehicleType: ' ' }).success, false);
  // A plate the chosen type does not carry is dropped, not stored.
  const single = driverProfileSchema.parse({ ...driver, plateType: 'SINGLE', hkPlate: 'AB1234', macauPlate: 'MA1234', mainlandPlate: 'AB123' });
  assert.deepEqual([single.hkPlate, single.macauPlate, single.mainlandPlate], ['AB1234', '', '']);
});
