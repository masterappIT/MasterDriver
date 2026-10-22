import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminSiteController, AppInterestController, PublicSiteController, UpdateNoticeController, UpgradeController } from './site.controllers';
import { SiteService } from './site.service';

@Module({
  imports: [AdminModule],
  controllers: [PublicSiteController, UpgradeController, UpdateNoticeController, AppInterestController, AdminSiteController],
  providers: [SiteService],
})
export class SiteModule {}
