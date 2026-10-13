import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { APP_CONFIG, type AppConfig } from '../config';
import { MEDIA_STORAGE, createMediaStorage } from './media-storage';
import { AdminSupportController, SupportController } from './support.controllers';
import { SupportService } from './support.service';

@Module({
  imports: [AdminModule],
  controllers: [SupportController, AdminSupportController],
  providers: [
    SupportService,
    { provide: MEDIA_STORAGE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createMediaStorage(config) },
  ],
  exports: [SupportService],
})
export class SupportModule {}
