/**
 * 客服 pictures and videos are kept for a limited time. This removes the
 * files past their keep-until time; the messages stay, marked as expired.
 * Run it on a schedule (for example once a day).
 *
 *   npm run support-media -- --purge
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  if (!process.argv.includes('--purge')) {
    console.log('Usage: npm run support-media -- --purge');
    return;
  }
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { SupportService } = await import('../support/support.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { removed } = await app.get(SupportService).purgeExpiredMedia();
    console.log(`Removed ${removed} expired file(s).`);
  } finally {
    await app.close();
  }
}

void main();
