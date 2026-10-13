import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminDataService } from './admin-data.service';
import { AdminAccountsController, AdminAuthController, AdminController } from './admin.controllers';
import { AdminGuard } from './admin.guard';
import { AuditService } from './audit.service';

@Module({
  imports: [EntitlementsModule, BillingModule],
  controllers: [AdminAuthController, AdminController, AdminAccountsController],
  providers: [AdminAuthService, AdminDataService, AdminGuard, AuditService],
  exports: [AdminAuthService],
})
export class AdminModule {}
