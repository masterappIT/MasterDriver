import type { PrismaService } from '../prisma.service';

/**
 * The limits against abuse set in the platform admin (防濫用設定). The row is
 * created with the schema's defaults the first time anything asks for it, so
 * every reader sees the same numbers the admin page shows.
 */
export function readLimits(prisma: Pick<PrismaService, 'limitSetting'>) {
  return prisma.limitSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
}
