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
