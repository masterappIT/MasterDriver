import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { AuthController } from './auth.controller';
import { AuthGuard, OptionalAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DevelopmentLoginService } from './development-login.service';
import { DevLogSmsProvider, SMS_PROVIDER } from './sms';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    DevelopmentLoginService,
    AuthGuard,
    OptionalAuthGuard,
    {
      provide: SMS_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new DevLogSmsProvider(config.devLogOtp),
    },
  ],
  exports: [AuthService, DevelopmentLoginService, AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
