import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, { provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [PrismaService, APP_CONFIG],
})
export class PrismaModule {}
