/**
 * Platform service fee and manual credit top-ups from the command line, until
 * the platform admin has its pages.
 *
 *   npm run billing -- --status
 *   npm run billing -- --fee-on --fee=5          switch the per-order fee on at HK$5
 *   npm run billing -- --fee-off
 *   npm run billing -- --top-up --phone=+852:91234567 --amount=100 --note="轉數快 #123"
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { commissionUpdateSchema } from '@masterdriver/shared';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const actor = `cli:${userInfo().username}`;
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { CommissionService } = await import('../billing/commission.service');
  const { CreditsService } = await import('../billing/credits.service');
  const { PrismaService } = await import('../prisma.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const commission = app.get(CommissionService);
    const fee = arg('fee');
    const enabled = flag('fee-on') ? true : flag('fee-off') ? false : undefined;
    if (enabled !== undefined || fee !== undefined) {
      await commission.update(
        commissionUpdateSchema.parse({ enabled, fee: fee === undefined ? undefined : Number(fee) }),
        actor,
      );
    }

    if (flag('top-up')) {
      const [countryCode, phone] = (arg('phone') ?? '').split(':');
      const amount = Number(arg('amount'));
      if (!countryCode || !phone || !(amount > 0)) throw new Error('Use --phone=+852:91234567 --amount=100');
      const user = await app.get(PrismaService).user.findUnique({ where: { countryCode_phone: { countryCode, phone } } });
      if (!user) throw new Error('No user with that phone number has signed in yet');
      const balance = await app
        .get(CreditsService)
        .credit(user.id, Math.round(amount * 100), { type: 'TOPUP', source: 'MANUAL', note: arg('note'), createdBy: actor });
      console.log({ toppedUp: `${countryCode} ${phone}`, amount, balance: balance / 100 });
    }

    console.log({ serviceFee: await commission.status() });
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
