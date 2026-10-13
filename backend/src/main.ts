import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Local development reads the repository's .env; real environments inject variables directly.
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function bootstrap() {
  // Imported after .env is loaded so configuration sees it.
  const { AppModule } = await import('./app.module');
  const { loadConfig } = await import('./config');
  const config = loadConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Cloud Run sits behind Google's front end; trust it for the client IP used in rate limits.
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  // Room for a QR image upload (at most 400 KB, about 540 KB as base64).
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.port);
  new Logger('Bootstrap').log(`MasterDriver API listening on port ${config.port}`);
}

void bootstrap();
