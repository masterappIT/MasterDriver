import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminSupportController, SupportController } from './support.controllers';
import { SupportService } from './support.service';

@Module({
  imports: [AdminModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
