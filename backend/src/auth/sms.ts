import { Logger } from '@nestjs/common';

export interface SmsProvider {
  sendVerificationCode(countryCode: string, phone: string, code: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * Development stand-in until an SMS provider is chosen (DECISIONS item 9).
 * Prints the code to the API log when DEV_LOG_OTP is on; otherwise refuses to
 * pretend a message was sent.
 */
export class DevLogSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  constructor(private readonly enabled: boolean) {}

  async sendVerificationCode(countryCode: string, phone: string, code: string) {
    if (!this.enabled) throw new Error('No SMS provider is configured');
    this.logger.warn(`[development] verification code for ${countryCode} ${phone}: ${code}`);
  }
}
