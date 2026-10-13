import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The process is up. Cloud Run's startup and liveness probes use this one:
   * a database incident must not make the platform restart healthy instances.
   */
  @Get('live')
  live() {
    return { ok: true };
  }

  /** The database answers. Used before a release takes traffic and by outside monitoring. */
  @Get('ready')
  ready() {
    return this.check();
  }

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
