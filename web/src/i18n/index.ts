import { ref } from 'vue';

export type Language = 'zh-Hant' | 'zh-Hans';

const KEY = 'md-language';
const read = (): Language | null => {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'zh-Hans' || value === 'zh-Hant' ? value : null;
  } catch {
    return null;
  }
};

/** Hong Kong and Macau numbers read Traditional, mainland numbers Simplified, unless the user picked one. */
export const languageForCountryCode = (countryCode?: string | null): Language =>
  countryCode === '+86' ? 'zh-Hans' : 'zh-Hant';

export const language = ref<Language>(read() ?? 'zh-Hant');

const HAS_CJK = /[㐀-鿿]/;
/** The Simplified converter and its character table are only downloaded when needed. */
let convert: ((text: string) => string) | null = null;
const converterReady = ref(false);

function ensureConverter() {
  if (convert) return;
  void import('./convert').then((module) => {
    convert = module.toSimplified;
    converterReady.value = true;
  });
}

if (language.value === 'zh-Hans') ensureConverter();

export function setLanguage(value: Language, remember = true) {
  language.value = value;
  if (value === 'zh-Hans') ensureConverter();
  document.documentElement.lang = value;
  if (!remember) return;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* the choice still applies until the page is reloaded */
  }
}

/** Follows the account's region unless the user chose a language on this device. */
export function adoptAccountLanguage(locale: string) {
  if (read()) return;
  setLanguage(locale === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant', false);
}

/** Text in the chosen language; non-Chinese text is returned unchanged. */
export function t(text: string): string {
  if (language.value === 'zh-Hant' || !HAS_CJK.test(text)) return text;
  // Reading converterReady makes templates re-render once the table has loaded.
  return converterReady.value && convert ? convert(text) : text;
}
