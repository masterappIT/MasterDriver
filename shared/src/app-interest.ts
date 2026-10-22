/**
 * App 意向問卷 (2026-10-23): asked once in the driver app, so the platform knows whether drivers
 * want a WeChat mini program or an app before either is built (docs/PLAN.md). Skipping counts as
 * answered. No dependencies, so the web app can use it without zod.
 */

export const APP_INTEREST_CHOICES = ['MINIPROGRAM', 'IOS_APP', 'ANDROID_APP', 'WEB_ENOUGH'] as const;
export type AppInterestChoice = (typeof APP_INTEREST_CHOICES)[number];

/** In the order the driver sees them; the last one rules out the others. */
export const APP_INTEREST_NAMES: Record<AppInterestChoice, string> = {
  MINIPROGRAM: '微信小程序',
  IOS_APP: 'iPhone App',
  ANDROID_APP: 'Android App',
  WEB_ENOUGH: '都不用，網頁就夠',
};

export const APP_INTEREST_NOTE_MAX = 200;

/** The choices as the driver left them: 網頁就夠 alone, or any of the others, each once. */
export function validAppInterest(choices: readonly AppInterestChoice[]) {
  if (choices.length === 0 || new Set(choices).size !== choices.length) return false;
  return !choices.includes('WEB_ENOUGH') || choices.length === 1;
}
