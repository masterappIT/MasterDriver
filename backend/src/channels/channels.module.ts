import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ChannelsController } from './channels.controller';
import { PaymentChannelsService } from './payment-channels.service';
import { SmsChannelsService } from './sms-channels.service';

@Module({
  imports: [AdminModule],
  controllers: [ChannelsController],
  providers: [PaymentChannelsService, SmsChannelsService],
  exports: [PaymentChannelsService, SmsChannelsService],
})
export class ChannelsModule {}
