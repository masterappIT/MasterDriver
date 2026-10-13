import { isIP } from 'node:net';
import { open, type CityResponse, type Reader } from 'maxmind';

/**
 * Where a request came from, by its IP and the DB-IP City Lite database (CC BY 4.0; the page
 * credits DB-IP). Rules after Master Travel's observability-region.ts (see docs/REUSE.md); the
 * IP is only looked up, never stored.
 */

/** For the speed and error table: 內地, 香港, 澳門 and the rest. */
export type Area = 'MAINLAND' | 'HONG_KONG' | 'MACAU' | 'OTHER' | 'INTERNAL' | 'UNKNOWN';
export interface Place {
  /** "中国 · 广东", "香港", "本機／內網", "未知地區", as Master Travel shows it. */
  region: string;
  area: Area;
}

export const INTERNAL: Place = { region: '本機／內網', area: 'INTERNAL' };
export const UNKNOWN: Place = { region: '未知地區', area: 'UNKNOWN' };

export function normalizeIp(value: string | undefined) {
  const raw = value?.split(',', 1)[0]?.trim();
  const candidate =
    raw?.startsWith('[') && raw.includes(']')
      ? raw.slice(1, raw.indexOf(']'))
      : raw && /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(raw)
        ? raw.slice(0, raw.lastIndexOf(':'))
        : raw;
  if (!candidate || !isIP(candidate)) return undefined;
  return candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
}

export function isPrivateIp(ip: string) {
  return (
    !ip ||
    ip === '::1' ||
    /^127\./.test(ip) ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^(172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip) ||
    /^169\.254\./.test(ip) ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    /^fe[89ab]/i.test(ip)
  );
}

const AREA_BY_COUNTRY: Record<string, Area> = { CN: 'MAINLAND', HK: 'HONG_KONG', MO: 'MACAU' };

export function placeFromGeoIp(ip: string | undefined, lookup: (ip: string) => CityResponse | null): Place {
  const normalized = normalizeIp(ip);
  if (isPrivateIp(normalized ?? '')) return INTERNAL;
  const record = lookup(normalized!);
  const country = record?.country?.names?.['zh-CN'] || record?.country?.names?.en;
  const subdivision = record?.subdivisions?.[0]?.names?.['zh-CN'] || record?.subdivisions?.[0]?.names?.en;
  const city = record?.city?.names?.['zh-CN'] || record?.city?.names?.en;
  const region = [country, subdivision || city].filter(Boolean).join(' · ');
  if (!region) return UNKNOWN;
  return { region, area: AREA_BY_COUNTRY[record?.country?.iso_code ?? ''] ?? 'OTHER' };
}

/**
 * Looks each address up once a day (an unknown one again after an hour), shares lookups made
 * at the same time, and answers 未知地區 when the database cannot be read, without caching that.
 */
export function createPlaceResolver(lookup: (ip: string) => Promise<Place>, onFailure: (error: unknown) => void) {
  const cache = new Map<string, { place: Place; expiresAt: number }>();
  const pending = new Map<string, Promise<Place>>();
  const cacheTtlMs = 24 * 60 * 60 * 1000;
  const cacheMaxEntries = 10_000;
  return async (ip: string | undefined): Promise<Place> => {
    const normalized = normalizeIp(ip);
    if (isPrivateIp(normalized ?? '')) return INTERNAL;
    const cached = cache.get(normalized!);
    if (cached && cached.expiresAt > Date.now()) return cached.place;
    const existing = pending.get(normalized!);
    if (existing) return existing;
    const request = lookup(normalized!)
      .then((place) => {
        cache.delete(normalized!);
        cache.set(normalized!, { place, expiresAt: Date.now() + (place.area === 'UNKNOWN' ? 60 * 60 * 1000 : cacheTtlMs) });
        if (cache.size > cacheMaxEntries) cache.delete(cache.keys().next().value!);
        return place;
      })
      .catch((error) => {
        onFailure(error);
        return UNKNOWN;
      })
      .finally(() => pending.delete(normalized!));
    pending.set(normalized!, request);
    return request;
  };
}

/** Where the image keeps the database (backend/Dockerfile); a local checkout usually has none. */
export const GEOIP_DEFAULT_PATH = '/app/backend/geoip/dbip-city-lite.mmdb';

let readerPromise: Promise<Reader<CityResponse>> | undefined;
export function lookUpLocalPlace(ip: string | undefined): Promise<Place> {
  if (isPrivateIp(normalizeIp(ip) ?? '')) return Promise.resolve(INTERNAL);
  readerPromise ??= open<CityResponse>(process.env.OBSERVABILITY_GEOIP_DB_PATH || GEOIP_DEFAULT_PATH).catch((error) => {
    readerPromise = undefined;
    throw error;
  });
  return readerPromise.then((reader) => placeFromGeoIp(ip, (value) => reader.get(value)));
}
