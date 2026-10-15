import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CarpoolsModule } from './carpools/carpools.module';
import { GroupsModule } from './groups/groups.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { ObservabilityModule } from './observability/observability.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma.module';
import { PreferencesController, ProfileController } from './profile/profile.controller';
import { ProfilePagesModule } from './profile-pages/profile-pages.module';
import { SiteModule } from './site/site.module';
import { StorageModule } from './storage/storage.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [PrismaModule, StorageModule, ObservabilityModule, NotificationsModule, AuthModule, OrdersModule, BillingModule, AdminModule, SiteModule, GroupsModule, PaymentMethodsModule, SupportModule, ProfilePagesModule, CarpoolsModule],
  controllers: [HealthController, ProfileController, PreferencesController],
})
export class AppModule {}
