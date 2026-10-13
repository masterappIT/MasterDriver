import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard, AdminRoles } from '../admin/admin.guard';
import { FLUSH_MS, ObservabilityService } from './observability.service';
import { telemetry } from './telemetry';

/** Like the 通知 stream: the web front end's proxy closes a response after 120 seconds. */
const STREAM_MS = 90_000;

/**
 * 數據流監控, for operators and super admins. The page reads the stream with fetch, since every
 * admin request carries the admin header, and opens a new one when it ends.
 */
@Controller('admin/observability')
@UseGuards(AdminGuard)
@AdminRoles('SUPER_ADMIN', 'OPERATOR')
export class ObservabilityController {
  constructor(@Inject(ObservabilityService) private readonly observability: ObservabilityService) {}

  /**
   * Server-sent events: a snapshot (counts, presence, business numbers, services) now and every
   * 15 seconds, and each request, business step and query on this instance as it happens.
   */
  @Get('stream')
  stream(@Res() response: Response) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const send = (data: unknown) => response.write(`data: ${JSON.stringify(data, (_, value) => (typeof value === 'bigint' ? Number(value) : value))}\n\n`);
    send({ type: 'stream:connected', instanceId: this.observability.instanceId, timestamp: new Date().toISOString() });

    let sequence = 0;
    const snapshot = () => {
      const current = ++sequence;
      void this.observability
        .snapshot()
        .then((data) => current === sequence && !response.writableEnded && send(data))
        .catch(() => !response.writableEnded && send({ type: 'snapshot:error', checkedAt: new Date().toISOString() }));
    };
    snapshot();
    const timer = setInterval(snapshot, FLUSH_MS);
    const stop = telemetry.listen(send);
    const end = setTimeout(() => response.end(), STREAM_MS);
    response.on('close', () => {
      clearInterval(timer);
      clearTimeout(end);
      stop();
    });
  }

  /** 司機訪問明細: phone numbers, so for super admins only. */
  @Get('presence-identities')
  @AdminRoles('SUPER_ADMIN')
  identities() {
    return this.observability.identities();
  }
}
