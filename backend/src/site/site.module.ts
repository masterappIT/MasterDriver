import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminSiteController, PublicSiteController } from './site.controllers';
import { SiteService } from './site.service';

@Module({
  imports: [AdminModule],
  controllers: [PublicSiteController, AdminSiteController],
  providers: [SiteService],
})
export class SiteModule {}
