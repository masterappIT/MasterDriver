import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { DispatchLinkController, OrdersController, PassengerLinkController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [EntitlementsModule, BillingModule],
  controllers: [OrdersController, DispatchLinkController, PassengerLinkController],
  providers: [OrdersService],
})
export class OrdersModule {}
