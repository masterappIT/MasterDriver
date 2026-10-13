export interface SmsProvider {
  sendVerificationCode(countryCode: string, phone: string, code: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
