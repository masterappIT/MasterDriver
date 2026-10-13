import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CityResponse } from 'maxmind';
import { createPlaceResolver, lookUpLocalPlace, normalizeIp, placeFromGeoIp, type Place } from './region';

// After Master Travel's observability-region.test.ts (see docs/REUSE.md).

const sample = {
  country: { iso_code: 'US', names: { en: 'United States', 'zh-CN': '美國' } },
  subdivisions: [{ names: { en: 'California' } }],
  city: { names: { en: 'Mountain View' } },
} as unknown as CityResponse;

test('normalizes proxy address formats', () => {
  assert.equal(normalizeIp('::ffff:8.8.8.8'), '8.8.8.8');
  assert.equal(normalizeIp('[2001:4860:4860::8888]:443'), '2001:4860:4860::8888');
  assert.equal(normalizeIp('8.8.8.8:443, 10.0.0.1'), '8.8.8.8');
  assert.equal(normalizeIp('not-an-ip'), undefined);
});

test('looks up public IPs and keeps private and unknown fallbacks', () => {
  const requested: string[] = [];
  const lookup = (ip: string) => {
    requested.push(ip);
    return sample;
  };
  assert.deepEqual(placeFromGeoIp('8.8.8.8', lookup), { region: '美國 · California', area: 'OTHER' });
  assert.deepEqual(requested, ['8.8.8.8']);
  assert.equal(placeFromGeoIp('192.168.1.4', lookup).region, '本機／內網');
  assert.equal(placeFromGeoIp('169.254.1.1', lookup).area, 'INTERNAL');
  assert.equal(placeFromGeoIp(undefined, lookup).area, 'INTERNAL');
  assert.deepEqual(requested, ['8.8.8.8']);
  assert.deepEqual(placeFromGeoIp('2001:4860:4860::8888', () => null), { region: '未知地區', area: 'UNKNOWN' });
});

test('mainland, Hong Kong and Macau are told apart by country code', () => {
  const at = (iso: string, name: string) => () => ({ country: { iso_code: iso, names: { 'zh-CN': name } } }) as unknown as CityResponse;
  assert.deepEqual(placeFromGeoIp('1.2.3.4', at('CN', '中国')), { region: '中国', area: 'MAINLAND' });
  assert.equal(placeFromGeoIp('1.2.3.4', at('HK', '香港')).area, 'HONG_KONG');
  assert.equal(placeFromGeoIp('1.2.3.4', at('MO', '澳门')).area, 'MACAU');
});

test('lookup failures are not cached but genuine unknown results are', async () => {
  let attempts = 0;
  const failures: unknown[] = [];
  const found: Place = { region: '美國 · California', area: 'OTHER' };
  const resolve = createPlaceResolver(
    async () => {
      attempts++;
      if (attempts === 1) throw new Error('database unavailable');
      return attempts === 2 ? found : { region: '未知地區', area: 'UNKNOWN' };
    },
    (error) => failures.push(error),
  );
  assert.equal((await resolve('8.8.8.8')).region, '未知地區');
  assert.equal((await resolve('8.8.8.8')).region, '美國 · California');
  assert.equal((await resolve('8.8.8.8')).region, '美國 · California');
  assert.equal(failures.length, 1);
  assert.equal(attempts, 2);
  assert.equal((await resolve('1.1.1.1')).region, '未知地區');
  assert.equal((await resolve('1.1.1.1')).region, '未知地區');
  assert.equal(attempts, 3);
});

test('coalesces concurrent lookups and keeps private addresses out of the cache', async () => {
  let attempts = 0;
  const resolve = createPlaceResolver(
    async () => {
      attempts++;
      await new Promise((done) => setTimeout(done, 1));
      return { region: '美國', area: 'OTHER' };
    },
    () => assert.fail('unexpected lookup failure'),
  );
  assert.deepEqual((await Promise.all([resolve('8.8.8.8'), resolve('8.8.8.8')])).map((place) => place.region), ['美國', '美國']);
  assert.equal((await resolve('10.0.0.2')).region, '本機／內網');
  assert.equal(attempts, 1);
});

test('a missing database does not block private addresses and can recover', async () => {
  const oldPath = process.env.OBSERVABILITY_GEOIP_DB_PATH;
  process.env.OBSERVABILITY_GEOIP_DB_PATH = '/tmp/observability-geoip-no-such-file.mmdb';
  try {
    assert.equal((await lookUpLocalPlace('10.0.0.2')).region, '本機／內網');
    await assert.rejects(lookUpLocalPlace('8.8.8.8'), { code: 'ENOENT' });
    await assert.rejects(lookUpLocalPlace('8.8.4.4'), { code: 'ENOENT' });
  } finally {
    if (oldPath === undefined) delete process.env.OBSERVABILITY_GEOIP_DB_PATH;
    else process.env.OBSERVABILITY_GEOIP_DB_PATH = oldPath;
  }
});
