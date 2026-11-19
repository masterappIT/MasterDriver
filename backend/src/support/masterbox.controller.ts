import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { MASTERBOX_CREDENTIAL_SECONDS, signMasterBoxCredential } from './masterbox-credential';

/** 客服 is MasterBox Chat Box (2026-11-18): a signed-in driver gets the credential that tells MasterBox who they are. */
@Controller('support')
@UseGuards(AuthGuard)
export class MasterBoxController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('masterbox-credential')
  async credential(@CurrentUser() user: SessionUser) {
    const { masterboxAppId: appId, masterboxSigningSecret: signingSecret } = this.config;
    // No key on this server: the driver chats as a visitor. Not an error, so the app does not retry it.
    if (!appId || !signingSecret) return { token: null, expiresInSeconds: 0 };
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId: user.id }, select: { name: true } });
    return { token: signMasterBoxCredential({ id: user.id, name: profile?.name }, { appId, signingSecret }), expiresInSeconds: MASTERBOX_CREDENTIAL_SECONDS };
  }
}
