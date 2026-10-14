import { Global, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { LoadReportController } from './load-report.controller';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';

/** Global: the 通知 streams report their connections here. */
@Global()
@Module({
  imports: [AdminModule],
  controllers: [ObservabilityController, LoadReportController],
  providers: [ObservabilityService],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
