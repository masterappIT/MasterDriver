import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { GroupsModule } from './groups/groups.module';
import { HealthController } from './health.controller';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma.module';
import { PreferencesController, ProfileController } from './profile/profile.controller';
import { SiteModule } from './site/site.module';

@Module({
  imports: [PrismaModule, AuthModule, OrdersModule, BillingModule, AdminModule, SiteModule, GroupsModule],
  controllers: [HealthController, ProfileController, PreferencesController],
})
export class AppModule {}
