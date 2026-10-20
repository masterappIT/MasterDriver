import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  composeMainlandPlate,
  plateRegions,
  formatHongKongPlateInput,
  formatMacauPlateInput,
  inferVehiclePlates,
  mainlandPlateInput,
  normalizeVehiclePlates,
  plateFieldsFor,
  plateTypesFor,
  vehiclePlateError,
  type VehiclePlates,
} from './vehicle-plate';

const fields = (...args: Parameters<typeof plateFieldsFor>) =>
  plateFieldsFor(...args).map((entry) => `${entry.field}${entry.required ? '' : '?'}`);

test('the plates asked for follow the ownership and the plate type', () => {
  assert.deepEqual(fields('HK', 'SINGLE'), ['hkPlate']);
  assert.deepEqual(fields('HK', 'DUAL'), ['hkPlate', 'mainlandPlate']);
  assert.deepEqual(fields('HK', 'TRIPLE'), ['hkPlate', 'macauPlate?', 'mainlandPlate']);
  assert.deepEqual(fields('MACAU', 'SINGLE'), ['macauPlate']);
  assert.deepEqual(fields('MACAU', 'DUAL'), ['macauPlate', 'mainlandPlate']);
  assert.deepEqual(fields('MACAU', 'TRIPLE'), ['hkPlate', 'macauPlate', 'mainlandPlate']);
  assert.deepEqual(fields('MAINLAND', 'DUAL'), ['mainlandPlate', 'hkPlate']);
  assert.deepEqual(plateTypesFor('MAINLAND'), ['DUAL']);
  assert.deepEqual(plateTypesFor('HK'), ['SINGLE', 'DUAL', 'TRIPLE']);
});

test('plate inputs keep only what each plate may contain', () => {
  assert.equal(formatHongKongPlateInput('ab 1234-xyz99'), 'AB 1234XY');
  assert.equal(formatMacauPlateInput('ma1234'), 'MA-12-34');
  assert.equal(formatMacauPlateInput('m1a2345678'), 'MA-23-45');
  assert.equal(formatMacauPlateInput('MA-12'), 'MA-12');
});

test('the mainland plate is typed without its fixed parts and stored whole', () => {
  assert.equal(composeMainlandPlate('ab123', 'HK'), '粵Z·AB123港');
  assert.equal(composeMainlandPlate('ab123', 'MACAU'), '粵Z·AB123澳');
  assert.equal(composeMainlandPlate('b12345', 'MAINLAND'), '粵B·12345');
  assert.equal(composeMainlandPlate('B·12345', 'MAINLAND'), '粵B·12345');
  assert.equal(composeMainlandPlate('', 'HK'), '');
  // A stored plate, in the old loose spelling too, goes back into the input as typed.
  assert.equal(mainlandPlateInput('粵Z·AB123港', 'HK'), 'AB123');
  assert.equal(mainlandPlateInput('粤z1234港', 'HK'), '1234');
  assert.equal(mainlandPlateInput('粵Z·AB123澳', 'MACAU'), 'AB123');
  assert.equal(mainlandPlateInput('粵B·12345', 'MAINLAND'), 'B·12345');
});

const check = (input: VehiclePlates) => vehiclePlateError({ ...input, ...normalizeVehiclePlates(input) });

test('every plate the type carries must be there and well formed', () => {
  assert.equal(check({ vehicleOwnership: 'HK', plateType: 'SINGLE', hkPlate: 'ab1234' }), null);
  assert.equal(check({ vehicleOwnership: 'HK', plateType: 'DUAL', hkPlate: 'AB1234' }), 'PLATE_REQUIRED');
  assert.equal(check({ vehicleOwnership: 'HK', plateType: 'DUAL', hkPlate: 'AB1234', mainlandPlate: 'ab123' }), null);
  assert.equal(check({ vehicleOwnership: 'HK', plateType: 'TRIPLE', hkPlate: 'AB1234', mainlandPlate: 'AB123' }), null);
  assert.equal(check({ vehicleOwnership: 'MACAU', plateType: 'TRIPLE', hkPlate: 'AB1234', mainlandPlate: 'AB123' }), 'PLATE_REQUIRED');
  assert.equal(check({ vehicleOwnership: 'MACAU', plateType: 'SINGLE', macauPlate: 'MA1234' }), null);
  assert.equal(check({ vehicleOwnership: 'MACAU', plateType: 'SINGLE', macauPlate: 'MA12' }), 'MACAU_PLATE_INVALID');
  assert.equal(check({ vehicleOwnership: 'MAINLAND', plateType: 'DUAL', hkPlate: 'AB1234', mainlandPlate: 'B12345' }), null);
  assert.equal(check({ vehicleOwnership: 'MAINLAND', plateType: 'DUAL', hkPlate: 'AB1234', mainlandPlate: '12345' }), 'MAINLAND_PLATE_INVALID');
  assert.equal(check({ vehicleOwnership: 'MAINLAND', plateType: 'SINGLE', mainlandPlate: 'B12345', hkPlate: 'AB1234' }), 'PLATE_TYPE_NOT_ALLOWED');
  assert.equal(check({ vehicleOwnership: 'HK', plateType: 'SINGLE', hkPlate: 'AB12345678' }), 'HK_PLATE_INVALID');
  assert.equal(check({ vehicleOwnership: 'HK', plateType: 'SINGLE', hkPlate: 'AB-123' }), 'HK_PLATE_INVALID');
});

test('a profile from before these choices opens on the ownership and type its plates fit', () => {
  assert.deepEqual(inferVehiclePlates({}), { vehicleOwnership: 'HK', plateType: 'DUAL' });
  assert.deepEqual(inferVehiclePlates({ hkPlate: 'TE123' }), { vehicleOwnership: 'HK', plateType: 'SINGLE' });
  assert.deepEqual(inferVehiclePlates({ hkPlate: 'AB1234', mainlandPlate: '粤Z1234港' }), { vehicleOwnership: 'HK', plateType: 'DUAL' });
  assert.deepEqual(inferVehiclePlates({ hkPlate: 'AB1234', macauPlate: 'MA-12-34', mainlandPlate: '粵Z·1234港' }), { vehicleOwnership: 'HK', plateType: 'TRIPLE' });
  assert.deepEqual(inferVehiclePlates({ macauPlate: 'MA-12-34' }), { vehicleOwnership: 'MACAU', plateType: 'SINGLE' });
  assert.deepEqual(inferVehiclePlates({ macauPlate: 'MA-12-34', mainlandPlate: '粵Z·1234澳' }), { vehicleOwnership: 'MACAU', plateType: 'DUAL' });
  assert.deepEqual(inferVehiclePlates({ hkPlate: 'AB1234', mainlandPlate: '粵B12345' }), { vehicleOwnership: 'MAINLAND', plateType: 'DUAL' });
});

test('plate regions name where the plates are from, never their numbers', () => {
  assert.deepEqual(plateRegions({ hkPlate: 'AB 1234' }), ['香港']);
  assert.deepEqual(plateRegions({ hkPlate: 'AB 1234', mainlandPlate: '粵Z·1234港' }), ['香港', '粵Z']);
  assert.deepEqual(plateRegions({ hkPlate: 'AB 1234', macauPlate: 'MA-12-34', mainlandPlate: '粵Z·1234港' }), ['香港', '澳門', '粵Z']);
  assert.deepEqual(plateRegions({ mainlandPlate: '粵A·B1234' }), ['粵A']);
  assert.deepEqual(plateRegions({}), []);
  assert.ok(!plateRegions({ hkPlate: 'AB 1234', mainlandPlate: '粵Z·1234港' }).join('').includes('1234'));
});
