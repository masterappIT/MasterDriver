import { Module } from '@nestjs/common';
import { ProfilePagesModule } from '../profile-pages/profile-pages.module';
import { DealsController, PublicDealsController } from './deals.controllers';
import { DealsService } from './deals.service';

@Module({
  imports: [ProfilePagesModule],
  controllers: [DealsController, PublicDealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
