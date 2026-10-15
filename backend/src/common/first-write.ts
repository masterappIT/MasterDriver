import { Prisma } from '../../generated/prisma';

/**
 * Runs a write that may make a row nobody has made yet: an upsert of a single-row setting or of
 * a day's counter. Prisma's upsert looks for the row and creates it when missing, so two first
 * callers at once can both try to create it; the one that loses (P2002) runs the write again
 * and finds the row. Not for use inside a transaction: there the failed statement aborts it.
 */
export async function retryFirstWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    return write();
  }
}
