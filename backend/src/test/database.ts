import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '../../generated/prisma';
import { AdminAuthService } from '../admin/admin-auth.service';
import { AdminDataService } from '../admin/admin-data.service';
import { AuditService } from '../admin/audit.service';
import { AuthService } from '../auth/auth.service';
import { CommissionService } from '../billing/commission.service';
import { CreditsService } from '../billing/credits.service';
import { DevelopmentLoginService } from '../auth/development-login.service';
import type { SmsProvider } from '../auth/sms';
import { loadConfig } from '../config';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { OrdersService } from '../orders/orders.service';
import type { PrismaService } from '../prisma.service';

const root = resolve(__dirname, '../../..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const TABLES = [
  'AdminAuditLog',
  'AdminSession',
  'Administrator',
  'CreditEntry',
  'CreditAccount',
  'CommissionSetting',
  'OrderClaim',
  'Order',
  'Usage',
  'EntitlementOverride',
  'Subscription',
  'BillingPolicy',
  'PlanFeature',
  'Plan',
  'Feature',
  'Session',
  'VerificationCode',
  'PhoneLoginDevelopmentSetting',
  'DriverProfile',
  'User',
];

export class CapturingSms implements SmsProvider {
  sent: { countryCode: string; phone: string; code: string }[] = [];
  async sendVerificationCode(countryCode: string, phone: string, code: string) {
    this.sent.push({ countryCode, phone, code });
  }
}

/**
 * Creates (if needed) and migrates the separate test database, then builds the
 * services against it. Never touches the development database's data.
 */
export async function setupDatabase() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  const name = new URL(testUrl).pathname.slice(1);
  if (!/^\w+_test$/.test(name)) throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');

  const admin = new PrismaClient({ datasources: { db: { url: testUrl.replace(/\/\w+(\?|$)/, '/postgres$1') } } });
  const exists = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();

  execSync('npx prisma migrate deploy --schema ../prisma/schema.prisma', {
    cwd: resolve(root, 'backend'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'ignore',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } }) as unknown as PrismaService;
  const config = { ...loadConfig({}), publicBaseUrl: 'https://md.test', otpPepper: 'test-pepper' };
  const sms = new CapturingSms();
  const developmentLogin = new DevelopmentLoginService(prisma, config);
  const entitlements = new EntitlementsService(prisma);
  const commission = new CommissionService(prisma, entitlements);
  const credits = new CreditsService(prisma);
  const audit = new AuditService(prisma);
  return {
    prisma,
    sms,
    developmentLogin,
    auth: new AuthService(prisma, config, sms, developmentLogin),
    entitlements,
    commission,
    credits,
    orders: new OrdersService(prisma, entitlements, commission, credits, config),
    audit,
    adminAuth: new AdminAuthService(prisma, audit),
    adminData: new AdminDataService(prisma, audit, credits, commission, entitlements),
    async reset() {
      sms.sent = [];
      await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((table) => `"${table}"`).join(', ')} CASCADE`);
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof setupDatabase>>;

let phoneSeed = 0;

/** A signed-up user with a driver profile, ready to dispatch and claim. */
export async function createDriver(ctx: TestContext, name = '測試師傅') {
  phoneSeed += 1;
  const user = await ctx.prisma.user.create({
    data: { countryCode: '+852', phone: String(91000000 + phoneSeed), profile: { create: { name, hkPlate: `TE${phoneSeed}` } } },
  });
  return user.id;
}

/** The plan catalogue from the seed, reduced to what the tests need. */
export async function seedPlans(ctx: TestContext, freeQuota: number) {
  await ctx.prisma.feature.create({ data: { key: 'order.create', name: '每月發單數', kind: 'QUOTA' } });
  await ctx.prisma.plan.create({ data: { key: 'free', name: 'free', rank: 0, isDefault: true } });
  await ctx.prisma.plan.create({ data: { key: 'company', name: 'company', rank: 2 } });
  await ctx.prisma.planFeature.createMany({
    data: [
      { planKey: 'free', featureKey: 'order.create', quota: freeQuota },
      { planKey: 'company', featureKey: 'order.create', quota: null },
    ],
  });
}

export const sampleOrder = {
  pickupAt: '2026-10-15T14:30:00+08:00',
  origin: '深圳灣口岸',
  destination: '香港國際機場',
  waypoints: [],
  passengers: 4,
  luggage: 3,
  passengerContact: '+852 9876 5432',
};

/** Asserts that an API call fails with the given stable error code. */
export async function rejectsWith(promise: Promise<unknown>, code: string) {
  const { rejects } = await import('node:assert/strict');
  await rejects(promise, (error: { response?: { code?: string } }) => {
    if (error?.response?.code !== code) throw new Error(`expected ${code}, got ${JSON.stringify(error?.response ?? error)}`);
    return true;
  });
}
