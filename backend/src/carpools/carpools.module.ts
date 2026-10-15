import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { CarpoolsController, PassengerSeatMediaController, PublicCarpoolsController } from './carpools.controllers';
import { CarpoolsService } from './carpools.service';

@Module({
  imports: [OrdersModule, PaymentMethodsModule],
  controllers: [CarpoolsController, PublicCarpoolsController, PassengerSeatMediaController],
  providers: [CarpoolsService],
})
export class CarpoolsModule {}
