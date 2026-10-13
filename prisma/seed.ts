/**
 * Seeds the billing catalogue and the launch free period. Safe to run repeatedly:
 * it updates names and plan contents, and creates the free-period policy only
 * if none with that name exists (so a policy already ended in the admin stays ended).
 *
 *   npm run prisma:seed
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '../backend/generated/prisma';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const features = [
  { key: 'order.create', name: '每月發單數', kind: 'QUOTA' as const },
  { key: 'team.manage', name: '團隊成員與副手', kind: 'SWITCH' as const },
  { key: 'order.directAssign', name: '直接指派、報名後挑選', kind: 'SWITCH' as const },
  { key: 'stats.export', name: '統計匯出', kind: 'SWITCH' as const },
  { key: 'brand.removeMark', name: '去除工具標記', kind: 'SWITCH' as const },
  { key: 'commission.exempt', name: '免平台服務費', kind: 'SWITCH' as const },
];

// Quotas are placeholders until pricing is decided (DECISIONS item 3 and 5); edit them in the admin.
const plans: { key: string; name: string; rank: number; isDefault: boolean; grants: Record<string, number | null> }[] = [
  { key: 'free', name: '個人（免費）', rank: 0, isDefault: true, grants: { 'order.create': 50 } },
  {
    key: 'team',
    name: '團隊',
    rank: 1,
    isDefault: false,
    grants: {
      'order.create': 500,
      'team.manage': null,
      'order.directAssign': null,
      'brand.removeMark': null,
      'commission.exempt': null,
    },
  },
  {
    key: 'company',
    name: '公司',
    rank: 2,
    isDefault: false,
    grants: {
      'order.create': null,
      'team.manage': null,
      'order.directAssign': null,
      'stats.export': null,
      'brand.removeMark': null,
      'commission.exempt': null,
    },
  },
];

const LAUNCH_FREE_PERIOD = '上線全站免費期';

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const feature of features) {
      await prisma.feature.upsert({ where: { key: feature.key }, update: feature, create: feature });
    }
    for (const { grants, ...plan } of plans) {
      await prisma.plan.upsert({ where: { key: plan.key }, update: plan, create: plan });
      await prisma.planFeature.deleteMany({ where: { planKey: plan.key } });
      await prisma.planFeature.createMany({
        data: Object.entries(grants).map(([featureKey, quota]) => ({ planKey: plan.key, featureKey, quota })),
      });
    }
    const existing = await prisma.billingPolicy.findFirst({ where: { name: LAUNCH_FREE_PERIOD } });
    if (!existing) {
      await prisma.billingPolicy.create({ data: { name: LAUNCH_FREE_PERIOD, planKey: 'company', startsAt: new Date() } });
    }
    console.log('Seeded features, plans and the launch free period.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
