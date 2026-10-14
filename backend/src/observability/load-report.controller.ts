import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../common/zod-pipe';
import { loadReportSchema, type LoadReport } from './load-report';
import { ObservabilityService } from './observability.service';

/** Where the phones say how opening a page went (see load-report.ts). No sign-in. */
@Controller('public')
export class LoadReportController {
  constructor(@Inject(ObservabilityService) private readonly observability: ObservabilityService) {}

  @Post('load-report')
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(@Body(new ZodPipe(loadReportSchema)) body: LoadReport, @Req() request: Request) {
    await this.observability.reportClientLoad(request, body);
  }
}
