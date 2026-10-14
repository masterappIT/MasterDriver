import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { GroupsModule } from '../groups/groups.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { DispatchLinkController, MyDriversController, OrdersController, PassengerLinkController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [EntitlementsModule, BillingModule, GroupsModule, PaymentMethodsModule],
  controllers: [OrdersController, MyDriversController, DispatchLinkController, PassengerLinkController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
