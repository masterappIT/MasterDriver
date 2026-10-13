/**
 * Development-mode sign-in from the command line, until the platform admin has
 * its settings page. Prints the status only; it never prints the code.
 *
 *   npm --workspace backend run dev-login -- --status
 *   npm --workspace backend run dev-login -- --on --code=123456
 *   npm --workspace backend run dev-login -- --off
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { developmentLoginUpdateSchema } from '@masterdriver/shared';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  const args = process.argv.slice(2);
  const code = args.find((arg) => arg.startsWith('--code='))?.slice('--code='.length);
  const enabled = args.includes('--on') ? true : args.includes('--off') ? false : undefined;

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { DevelopmentLoginService } = await import('../auth/development-login.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const service = app.get(DevelopmentLoginService);
    if (enabled !== undefined || code !== undefined) {
      const input = developmentLoginUpdateSchema.parse({ enabled, code });
      await service.update(input, `cli:${userInfo().username}`);
    }
    console.log(await service.status());
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
