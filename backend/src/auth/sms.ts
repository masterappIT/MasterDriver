export interface SmsProvider {
  /** Whether a code sent to this country code would go out now, as the SMS settings stand. */
  canSend(countryCode: string): Promise<boolean>;
  sendVerificationCode(countryCode: string, phone: string, code: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
