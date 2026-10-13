import { Global, Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { SmsChannelsService } from '../channels/sms-channels.service';
import { AuthController } from './auth.controller';
import { AuthGuard, OptionalAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DevelopmentLoginService } from './development-login.service';
import { SMS_PROVIDER } from './sms';

@Global()
@Module({
  imports: [ChannelsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    DevelopmentLoginService,
    AuthGuard,
    OptionalAuthGuard,
    // 253 雲通訊 through the admin-configured channels; logs the code locally when none is set up.
    { provide: SMS_PROVIDER, useExisting: SmsChannelsService },
  ],
  exports: [AuthService, DevelopmentLoginService, AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
