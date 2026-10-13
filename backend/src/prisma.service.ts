import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }> implements OnModuleDestroy {
  /** 數據流監控 listens here for the 資料庫 node; set by ObservabilityService. */
  static onQuery: ((sql: string, durationMs: number) => void) | undefined;

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    this.$on('query', (event) => PrismaService.onQuery?.(event.query, event.duration));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
