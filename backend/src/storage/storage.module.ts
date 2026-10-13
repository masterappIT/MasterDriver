import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { MEDIA_STORAGE, createMediaStorage } from './media-storage';

/** One media storage for the whole API (see media-storage.ts). */
@Global()
@Module({
  providers: [{ provide: MEDIA_STORAGE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createMediaStorage(config) }],
  exports: [MEDIA_STORAGE],
})
export class StorageModule {}
