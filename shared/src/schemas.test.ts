import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOrderSchema, driverProfileSchema, groupInviteCreateSchema, otpRequestSchema } from './schemas';
import { defaultLocaleFor, isValidMobile } from './phone';
import { bookingCreateSchema } from './profile-page';

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
  assert.equal(createOrderSchema.safeParse({ pickupAt: '2026-10-15T14:30:00+08:00', origin: '澳门', destination: '香港' }).success, false);
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

test('a 接駁 order holds its second leg; the dispatcher may drive one leg, never with 這單我自己做', () => {
  const order = { pickupAt: '2026-10-15T14:30:00+08:00', origin: '香港', destination: '廣州', passengers: 2, passengerContact: '+852 91234567' };
  const second = { place: ' 深圳灣口岸 ', pickupAt: '2026-10-15T15:30:00+08:00', requiredPlates: ['MAINLAND', 'HK'] };
  const parsed = createOrderSchema.parse({ ...order, transfer: second });
  assert.equal(parsed.transfer?.place, '深圳灣口岸');
  assert.deepEqual(parsed.transfer?.requiredPlates, ['HK', 'MAINLAND']);
  assert.equal(parsed.transfer?.selfDriveLeg, null);
  assert.equal(createOrderSchema.parse({ ...order, transfer: { ...second, selfDriveLeg: 2 } }).transfer?.selfDriveLeg, 2);
  assert.equal(createOrderSchema.safeParse({ ...order, transfer: { ...second, selfDriveLeg: 3 } }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...order, transfer: { ...second, place: ' ' } }).success, false);
  const both = createOrderSchema.safeParse({ ...order, selfDrive: true, transfer: second });
  assert.equal(both.success, false);
  if (!both.success) assert.equal(both.error.issues[0].message, 'SELF_DRIVE_ONE_LEG');
});

test('a 往返 order holds its way back; 同一位司機來回 by default, never together with 接駁', () => {
  const order = { pickupAt: '2026-10-15T09:00:00+08:00', origin: '香港', destination: '深圳', passengers: 2, passengerContact: '+852 91234567' };
  const back = { pickupAt: '2026-10-15T18:00:00+08:00', driverPrice: { amount: 500, currency: 'HKD' } };
  const parsed = createOrderSchema.parse({ ...order, flightNo: 'CX101', roundTrip: { ...back, flightNo: ' CX102 ' } });
  assert.equal(parsed.roundTrip?.sameDriver, true);
  assert.equal(parsed.flightNo, 'CX101');
  assert.equal(parsed.roundTrip?.flightNo, 'CX102', 'the way back has its own flight');
  assert.equal(parsed.roundTrip?.origin, undefined, 'no places: the way there reversed');
  const elsewhere = createOrderSchema.parse({ ...order, roundTrip: { ...back, origin: ' 福田口岸 ', destination: '' } });
  assert.equal(elsewhere.roundTrip?.origin, '福田口岸');
  assert.equal(elsewhere.roundTrip?.destination, undefined);
  assert.equal(parsed.roundTrip?.selfDriveLeg, null);
  // 同一位司機來回 with 這單我自己做: both legs the dispatcher's.
  assert.equal(createOrderSchema.safeParse({ ...order, roundTrip: back, selfDrive: true }).success, true);
  // 可分開接: one leg the dispatcher's, through selfDriveLeg only.
  assert.equal(createOrderSchema.parse({ ...order, roundTrip: { ...back, sameDriver: false, selfDriveLeg: 2 } }).roundTrip?.selfDriveLeg, 2);
  const issue = (input: object) => {
    const result = createOrderSchema.safeParse(input);
    return result.success ? null : result.error.issues[0].message;
  };
  assert.equal(issue({ ...order, roundTrip: { ...back, sameDriver: false }, selfDrive: true }), 'SELF_DRIVE_ONE_LEG');
  assert.equal(issue({ ...order, roundTrip: { ...back, selfDriveLeg: 1 } }), 'SELF_DRIVE_BOTH_LEGS');
  assert.equal(issue({ ...order, roundTrip: back, transfer: { place: '深圳灣口岸', pickupAt: '2026-10-15T10:00:00+08:00' } }), 'ONE_JOURNEY_KIND');
});

test('a 名片頁 booking may ask for 往返 with a way back after the way there, never with 接駁', () => {
  const booking = {
    pickupAt: '2026-10-20T10:00:00+08:00',
    origin: '香港國際機場',
    destination: '深圳灣口岸',
    passengers: 2,
    passengerName: '王小姐',
    passengerContact: '+852 91234567',
  };
  const issue = (input: object) => {
    const result = bookingCreateSchema.safeParse(input);
    return result.success ? null : result.error.issues[0].message;
  };
  const parsed = bookingCreateSchema.parse({ ...booking, roundTrip: true, returnPickupAt: '2026-10-20T18:00:00+08:00' });
  assert.equal(parsed.roundTrip, true);
  assert.equal(parsed.returnPickupAt, '2026-10-20T18:00:00+08:00');
  assert.equal(issue({ ...booking, roundTrip: true }), 'RETURN_TIME_REQUIRED');
  assert.equal(issue({ ...booking, roundTrip: true, returnPickupAt: '2026-10-20T09:00:00+08:00' }), 'RETURN_BEFORE_PICKUP');
  assert.equal(issue({ ...booking, roundTrip: true, transfer: true, returnPickupAt: '2026-10-20T18:00:00+08:00' }), 'ONE_JOURNEY_KIND');
  // A way back sent without 往返 is dropped, its places too.
  const oneWay = bookingCreateSchema.parse({ ...booking, returnPickupAt: '2026-10-20T18:00:00+08:00', returnOrigin: '福田口岸' });
  assert.equal(oneWay.returnPickupAt, undefined);
  assert.equal(oneWay.returnOrigin, undefined);
  const elsewhere = bookingCreateSchema.parse({ ...booking, roundTrip: true, returnPickupAt: '2026-10-20T18:00:00+08:00', returnOrigin: ' 福田口岸 ', returnDestination: '' });
  assert.equal(elsewhere.returnOrigin, '福田口岸');
  assert.equal(elsewhere.returnDestination, undefined, 'empty means where the trip started');
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

test('a driver may give a 港澳 number and a 內地 number; each must be a mobile of that side', () => {
  const single = { ...driver, plateType: 'SINGLE', hkPlate: 'AB1234' };
  const parsed = driverProfileSchema.parse({ ...single, hkMacauPhone: '+853 6123 4567', mainlandPhone: '+8613812345678' });
  assert.equal(parsed.hkMacauPhone, '+853 61234567');
  assert.equal(parsed.mainlandPhone, '+86 13812345678');
  const blank = driverProfileSchema.parse({ ...single, hkMacauPhone: '', mainlandPhone: undefined });
  assert.equal(blank.hkMacauPhone, undefined);
  assert.equal(blank.hidePlates, false);
  const codes = (input: object) => {
    const result = driverProfileSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };
  assert.deepEqual(codes({ ...single, hkMacauPhone: '+86 13812345678' }), ['HK_MACAU_PHONE_INVALID']);
  assert.deepEqual(codes({ ...single, mainlandPhone: '+852 91234567' }), ['MAINLAND_PHONE_INVALID']);
  assert.deepEqual(codes({ ...single, hkMacauPhone: '+852 2123 4567' }), ['HK_MACAU_PHONE_INVALID']);
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

test('a group is added without a name: the type and the QR code or link say which it is', () => {
  const whatsapp = groupInviteCreateSchema.parse({ platform: 'WHATSAPP', inviteUrl: 'https://chat.whatsapp.com/AbCdEf1234567' });
  assert.equal(whatsapp.name, '');
  assert.equal(groupInviteCreateSchema.safeParse({ platform: 'WECHAT' }).success, false, 'WeChat still needs its QR image');
});

test('a 名片頁 booking takes a phone with its country code, and a WeChat ID only beside it', () => {
  const booking = {
    pickupAt: '2026-10-20T10:00:00+08:00',
    origin: '香港國際機場',
    destination: '深圳灣口岸',
    passengers: 2,
    passengerName: '王小姐',
  };
  const parsed = bookingCreateSchema.safeParse({ ...booking, passengerContact: '+86 138 0013 8000', passengerWechat: ' wang-test ' });
  assert.equal(bookingCreateSchema.safeParse({ ...booking, passengerName: ' ', passengerContact: '+86 138 0013 8000' }).success, false, 'a name is required');
  assert.ok(parsed.success);
  assert.equal(parsed.data.passengerContact, '+86 13800138000');
  assert.equal(parsed.data.passengerWechat, 'wang-test');
  for (const contact of ['wechat: wang-test', '91234567', '+852 1234', '']) {
    assert.equal(bookingCreateSchema.safeParse({ ...booking, passengerContact: contact }).success, false, contact);
  }
});

test('a 包車 order holds its hours and prices an hour, never with 接駁 or 往返 or a total of its own', () => {
  const order = { pickupAt: '2026-10-25T09:00:00+08:00', origin: '深圳灣口岸', destination: '深圳灣口岸', passengers: 3, passengerContact: '+852 91234567' };
  const charter = { minutes: 480, driverHourly: { amount: 250, currency: 'HKD' } };
  const parsed = createOrderSchema.parse({ ...order, charter: { ...charter, extras: ['PARKING', 'TOLLS', 'PARKING'] } });
  assert.equal(parsed.charter?.overtimeUnitMinutes, 30);
  assert.equal(parsed.charter?.overtimeGraceMinutes, 15);
  assert.deepEqual(parsed.charter?.extras, ['TOLLS', 'PARKING'], 'each 另計 once, in a fixed order');
  const issue = (input: object) => {
    const result = createOrderSchema.safeParse(input);
    return result.success ? null : result.error.issues[0].message;
  };
  // By half hours, one day at most.
  assert.equal(createOrderSchema.safeParse({ ...order, charter: { ...charter, minutes: 390 } }).success, true);
  assert.equal(issue({ ...order, charter: { ...charter, minutes: 400 } }), 'CHARTER_STEP');
  assert.equal(createOrderSchema.safeParse({ ...order, charter: { ...charter, minutes: 30 } }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...order, charter: { ...charter, minutes: 25 * 60 } }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...order, charter: { ...charter, overtimeUnitMinutes: 45 } }).success, false);
  assert.equal(issue({ ...order, charter: { minutes: 480, overtimeDriverHourly: 300 } }), 'OVERTIME_WITHOUT_HOURLY');
  assert.equal(issue({ ...order, charter, driverPrice: { amount: 2000, currency: 'HKD' } }), 'CHARTER_PRICE_HOURLY');
  assert.equal(issue({ ...order, charter, roundTrip: { pickupAt: '2026-10-25T18:00:00+08:00' } }), 'ONE_JOURNEY_KIND');
});
