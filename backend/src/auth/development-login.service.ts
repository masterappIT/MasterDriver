import { Inject, Injectable } from '@nestjs/common';
import type { DevelopmentLoginUpdate } from '@masterdriver/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { hmac } from '../common/crypto';
import { PrismaService } from '../prisma.service';

/** Code in force when the setting is first created; change it before switching the mode on. */
export const DEFAULT_DEVELOPMENT_CODE = '000000';
const SETTING_ID = 'default';

export function developmentCodeHash(pepper: string, code: string): string {
  return hmac(pepper, `development:${code}`);
}

export interface DevelopmentLoginStatus {
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Development-mode sign-in. Kept separate from the SMS provider: it never reads
 * or changes SMS settings, and no API ever returns the code or its hash.
 */
@Injectable()
export class DevelopmentLoginService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async setting() {
    return this.prisma.phoneLoginDevelopmentSetting.upsert({
      where: { id: SETTING_ID },
      update: {},
      create: { id: SETTING_ID, verificationCodeHash: developmentCodeHash(this.config.otpPepper, DEFAULT_DEVELOPMENT_CODE) },
    });
  }

  async status(): Promise<DevelopmentLoginStatus> {
    const setting = await this.setting();
    return { enabled: setting.enabled, updatedAt: setting.updatedAt.toISOString(), updatedBy: setting.updatedBy };
  }

  async update(input: DevelopmentLoginUpdate, actor: string): Promise<DevelopmentLoginStatus> {
    await this.setting();
    await this.prisma.phoneLoginDevelopmentSetting.update({
      where: { id: SETTING_ID },
      data: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.code === undefined ? {} : { verificationCodeHash: developmentCodeHash(this.config.otpPepper, input.code) }),
        updatedBy: actor,
      },
    });
    return this.status();
  }

  /** Read once when a code is requested; the result is stored on that request. */
  async forNewRequest(): Promise<{ enabled: boolean; codeHash: string }> {
    const setting = await this.setting();
    return { enabled: setting.enabled, codeHash: setting.verificationCodeHash };
  }
}
