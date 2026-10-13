import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { DispatchLinkController, OrdersController, PassengerLinkController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [EntitlementsModule],
  controllers: [OrdersController, DispatchLinkController, PassengerLinkController],
  providers: [OrdersService],
})
export class OrdersModule {}
