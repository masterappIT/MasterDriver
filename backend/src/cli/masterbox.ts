/**
 * 客服 is MasterBox Chat Box: every driver is a MasterBox customer, so its staff can find one who never opened 客服.
 * New and changed drivers are sent as it happens (masterbox/masterbox-customers.ts); this sends everyone, once after
 * MASTERBOX_API_KEY is set and again whenever needed (it only updates). At most 200 a minute, leaving room under
 * MasterBox's 300 a minute for the company's other requests.
 *
 *   npm run masterbox -- --sync-all
 *   docker exec masterdriver-api-<slot> node dist/cli/masterbox.js --sync-all   (on the server)
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PER_MINUTE = 200;
const PAGE = 100;

async function main() {
  if (!process.argv.includes('--sync-all')) {
    console.log('Usage: npm run masterbox -- --sync-all');
    return;
  }
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { PrismaService } = await import('../prisma.service');
  const { MasterBoxCustomers } = await import('../masterbox/masterbox-customers');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const masterbox = app.get(MasterBoxCustomers);
    if (!masterbox.enabled) {
      console.log('MASTERBOX_APP_ID and MASTERBOX_API_KEY are not both set: nothing sent.');
      process.exitCode = 1;
      return;
    }
    const prisma = app.get(PrismaService);
    const total = await prisma.user.count();
    const counts = { ok: 0, failed: 0, skipped: 0 };
    let cursor: string | undefined;
    for (;;) {
      const page = await prisma.user.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (page.length === 0) break;
      for (const { id } of page) {
        const started = Date.now();
        counts[await masterbox.syncNow(id)] += 1;
        const done = counts.ok + counts.failed + counts.skipped;
        if (done % 50 === 0) console.log(`${done}/${total}`);
        await new Promise((next) => setTimeout(next, Math.max(0, 60_000 / PER_MINUTE - (Date.now() - started))));
      }
      cursor = page[page.length - 1].id;
    }
    console.log(`Sent ${counts.ok}, failed ${counts.failed} (see the warnings above), gone meanwhile ${counts.skipped}.`);
    if (counts.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
