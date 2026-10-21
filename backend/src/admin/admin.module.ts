import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DealsModule } from '../deals/deals.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { GroupsModule } from '../groups/groups.module';
import { OrdersModule } from '../orders/orders.module';
import { ProfilePagesModule } from '../profile-pages/profile-pages.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminDataService } from './admin-data.service';
import { AdminAccountsController, AdminAuthController, AdminController } from './admin.controllers';
import { AdminGuard } from './admin.guard';
import { AuditService } from './audit.service';

@Module({
  imports: [EntitlementsModule, BillingModule, OrdersModule, ProfilePagesModule, GroupsModule, DealsModule],
  controllers: [AdminAuthController, AdminController, AdminAccountsController],
  providers: [AdminAuthService, AdminDataService, AdminGuard, AuditService],
  exports: [AdminAuthService, AdminGuard, AuditService],
})
export class AdminModule {}
