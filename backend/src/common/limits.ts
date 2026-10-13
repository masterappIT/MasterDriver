import { Prisma } from '../../generated/prisma';
import type { PrismaService } from '../prisma.service';

const ID = 'default';

/**
 * The limits against abuse set in the platform admin (防濫用設定). The row is
 * created with the schema's defaults the first time anything asks for it, so
 * every reader sees the same numbers the admin page shows.
 */
export async function readLimits(prisma: Pick<PrismaService, 'limitSetting'>) {
  const found = await prisma.limitSetting.findUnique({ where: { id: ID } });
  if (found) return found;
  try {
    return await prisma.limitSetting.create({ data: { id: ID } });
  } catch (error) {
    // Two first readers at once: the other one made the row.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    return prisma.limitSetting.findUniqueOrThrow({ where: { id: ID } });
  }
}
