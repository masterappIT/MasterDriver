import { Controller, Get, Inject, Module, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { CommissionService } from './commission.service';
import { CreditsService } from './credits.service';

/** The dispatcher's credit balance, recent entries and the service fee that applies to them. */
@Controller('me/credits')
@UseGuards(AuthGuard)
export class CreditsController {
  constructor(
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(CommissionService) private readonly commission: CommissionService,
  ) {}

  @Get()
  async get(@CurrentUser() user: SessionUser) {
    const [summary, serviceFee] = await Promise.all([this.credits.summary(user.id), this.commission.forUser(user.id)]);
    return { ...summary, serviceFee };
  }
}

@Module({
  imports: [EntitlementsModule],
  controllers: [CreditsController],
  providers: [CreditsService, CommissionService],
  exports: [CreditsService, CommissionService],
})
export class BillingModule {}
