import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig, type AppConfig } from './config';
import { SECRET_BOX, SecretBox } from './common/secret-box';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: SECRET_BOX, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new SecretBox(config.dataEncryptionKey) },
  ],
  exports: [PrismaService, APP_CONFIG, SECRET_BOX],
})
export class PrismaModule {}
