import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminSiteController, PublicSiteController, UpdateNoticeController, UpgradeController } from './site.controllers';
import { SiteService } from './site.service';

@Module({
  imports: [AdminModule],
  controllers: [PublicSiteController, UpgradeController, UpdateNoticeController, AdminSiteController],
  providers: [SiteService],
})
export class SiteModule {}
