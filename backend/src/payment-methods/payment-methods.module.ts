import { Module } from '@nestjs/common';
import { MyPaymentMethodsController, PassengerPaymentMethodsController } from './payment-methods.controllers';
import { PaymentMethodsService } from './payment-methods.service';

@Module({
  controllers: [MyPaymentMethodsController, PassengerPaymentMethodsController],
  providers: [PaymentMethodsService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
