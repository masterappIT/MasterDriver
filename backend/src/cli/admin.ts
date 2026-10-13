/**
 * Creates a platform admin account from the command line, typically the first
 * super admin. The generated password is printed once; change it after signing in.
 *
 *   npm run admin -- --create --username=vincent --name="Vincent" --role=SUPER_ADMIN
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminCreateSchema } from '@masterdriver/shared';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  if (!process.argv.includes('--create')) {
    console.log('Usage: npm run admin -- --create --username=<name> --name=<display name> --role=SUPER_ADMIN|OPERATOR|SALES');
    return;
  }
  const input = adminCreateSchema.parse({ username: arg('username'), displayName: arg('name'), role: arg('role') });
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { AdminAuthService } = await import('../admin/admin-auth.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { admin, password } = await app.get(AdminAuthService).createAccount(input, null);
    console.log({ created: admin.username, role: admin.role });
    console.log(`One-time password (shown only now): ${password}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
