import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { MasterBoxController } from './masterbox.controller';
import { AdminSupportController, SupportController } from './support.controllers';
import { SupportService } from './support.service';

@Module({
  imports: [AdminModule],
  controllers: [SupportController, AdminSupportController, MasterBoxController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
