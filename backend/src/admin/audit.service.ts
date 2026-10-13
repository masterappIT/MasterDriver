import { Inject, Injectable } from '@nestjs/common';
import type { AdminAuditQuery } from '@masterdriver/shared';
import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';

export const PAGE_SIZE = 30;

export interface AuditEntry {
  adminId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Never put passwords, keys or verification codes here. */
  detail?: Prisma.InputJsonValue;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, db: Prisma.TransactionClient = this.prisma) {
    await db.adminAuditLog.create({ data: entry });
  }

  async list(query: AdminAuditQuery) {
    const where: Prisma.AdminAuditLogWhereInput = query.action ? { action: { startsWith: query.action } } : {};
    const [total, rows] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { admin: { select: { username: true, displayName: true } } },
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        admin: row.admin,
        targetType: row.targetType,
        targetId: row.targetId,
        detail: row.detail,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
