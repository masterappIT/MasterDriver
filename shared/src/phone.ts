/** Country codes accepted for sign-in: Hong Kong, mainland China and Macau. */
export const COUNTRY_CODES = ['+852', '+86', '+853'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

const MOBILE_PATTERNS: Record<CountryCode, RegExp> = {
  // Hong Kong mobile numbers are 8 digits starting with 4, 5, 6, 7 or 9.
  '+852': /^[4-79]\d{7}$/,
  // Mainland mobile numbers are 11 digits starting with 1[3-9].
  '+86': /^1[3-9]\d{9}$/,
  // Macau mobile numbers are 8 digits starting with 6.
  '+853': /^6\d{7}$/,
};

/** Removes spaces, dashes and brackets that people type or paste with a number. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, '');
}

export function isValidMobile(countryCode: CountryCode, phone: string): boolean {
  return MOBILE_PATTERNS[countryCode].test(phone);
}

/** Default interface language for a new user: Simplified Chinese for mainland numbers. */
export function defaultLocaleFor(countryCode: CountryCode): 'zh-Hant' | 'zh-Hans' {
  return countryCode === '+86' ? 'zh-Hans' : 'zh-Hant';
}

/**
 * A passenger's phone on an order: Hong Kong and Macau 8 digits (landlines too, since
 * hotels and offices give those), mainland an 11-digit mobile. Passengers do not give a
 * WeChat ID when an order is put out, so only a phone with its country code is taken.
 */
const PASSENGER_PATTERNS: Record<CountryCode, RegExp> = {
  '+852': /^\d{8}$/,
  '+86': /^1\d{10}$/,
  '+853': /^\d{8}$/,
};

export function isValidPassengerPhone(countryCode: CountryCode, phone: string): boolean {
  return PASSENGER_PATTERNS[countryCode].test(normalizePhone(phone));
}

/** How a passenger phone is stored and shown: "+852 91234567". */
export function formatPassengerPhone(countryCode: CountryCode, phone: string): string {
  return `${countryCode} ${normalizePhone(phone)}`;
}

/**
 * Reads a contact written earlier (an older order, a 名片頁 booking) back into country code
 * and number. Returns null for anything that is not clearly one phone, such as a WeChat ID.
 */
export function splitPassengerPhone(raw: string): { countryCode: CountryCode; phone: string } | null {
  const value = normalizePhone(raw);
  const withCode = /^(\+852|\+853|\+86)(\d+)$/.exec(value);
  if (withCode) {
    const countryCode = withCode[1] as CountryCode;
    return isValidPassengerPhone(countryCode, withCode[2]) ? { countryCode, phone: withCode[2] } : null;
  }
  // Without a code, only a mainland mobile is unambiguous; 8 digits could be Hong Kong or Macau.
  if (/^1\d{10}$/.test(value)) return { countryCode: '+86', phone: value };
  return null;
}
