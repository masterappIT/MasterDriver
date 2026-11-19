import { Global, Module } from '@nestjs/common';
import { MasterBoxCustomers } from './masterbox-customers';
import { MasterBoxWebhook } from './masterbox-webhook';
import { MasterBoxWebhookController } from './masterbox-webhook.controller';

/** Global: signing in, saving a driver's details and deleting an account all keep MasterBox up to date. */
@Global()
@Module({
  controllers: [MasterBoxWebhookController],
  providers: [MasterBoxCustomers, MasterBoxWebhook],
  exports: [MasterBoxCustomers, MasterBoxWebhook],
})
export class MasterBoxModule {}
