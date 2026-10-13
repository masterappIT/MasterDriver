import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminCreate, AdminLogin, AdminPasswordChange, AdminRole } from '@masterdriver/shared';
import { apiError } from '../common/errors';
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma.service';
import { AuditService } from './audit.service';
import { generatePassword, hashPassword, verifyPassword } from './password';

export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USERNAME = 5;
const MAX_FAILURES_PER_IP = 20;
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  sessionId: string;
}

const publicAdmin = (admin: { id: string; username: string; displayName: string; role: AdminRole }) => ({
  id: admin.id,
  username: admin.username,
  displayName: admin.displayName,
  role: admin.role,
});

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async login(input: AdminLogin, ip: string | undefined, userAgent: string | undefined, now = new Date()) {
    const since = new Date(now.getTime() - LOCK_WINDOW_MS);
    const [byUsername, byIp] = await Promise.all([
      this.prisma.adminAuditLog.count({
        where: { action: 'admin.login.failed', targetId: input.username, createdAt: { gt: since } },
      }),
      ip
        ? this.prisma.adminAuditLog.count({ where: { action: 'admin.login.failed', ip, createdAt: { gt: since } } })
        : Promise.resolve(0),
    ]);
    if (byUsername >= MAX_FAILURES_PER_USERNAME || byIp >= MAX_FAILURES_PER_IP) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'ADMIN_LOGIN_LOCKED', 'Too many failed sign-ins; try again later');
    }

    const admin = await this.prisma.administrator.findUnique({ where: { username: input.username } });
    const valid = admin && !admin.disabledAt && (await verifyPassword(input.password, admin.passwordHash));
    if (!admin || !valid) {
      await this.audit.log({ adminId: null, action: 'admin.login.failed', targetType: 'username', targetId: input.username, ip });
      throw apiError(HttpStatus.UNAUTHORIZED, 'ADMIN_LOGIN_INVALID', 'Wrong username or password');
    }

    const token = randomToken();
    await this.prisma.$transaction([
      this.prisma.adminSession.create({
        data: {
          adminId: admin.id,
          tokenHash: sha256(token),
          ip,
          userAgent: userAgent?.slice(0, 300),
          expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_MS),
        },
      }),
      this.prisma.administrator.update({ where: { id: admin.id }, data: { lastLoginAt: now } }),
    ]);
    await this.audit.log({ adminId: admin.id, action: 'admin.login', ip });
    return { token, admin: publicAdmin(admin) };
  }

  async resolveSession(token: string, now = new Date()): Promise<AdminUser | null> {
    const session = await this.prisma.adminSession.findUnique({ where: { tokenHash: sha256(token) }, include: { admin: true } });
    if (!session || session.revokedAt || session.expiresAt <= now || session.admin.disabledAt) return null;
    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      await this.prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
    return { ...publicAdmin(session.admin), sessionId: session.id };
  }

  async logout(admin: AdminUser) {
    await this.prisma.adminSession.updateMany({ where: { id: admin.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ adminId: admin.id, action: 'admin.logout' });
  }

  async changeOwnPassword(admin: AdminUser, input: AdminPasswordChange) {
    const stored = await this.prisma.administrator.findUniqueOrThrow({ where: { id: admin.id } });
    if (!(await verifyPassword(input.currentPassword, stored.passwordHash))) {
      throw apiError(HttpStatus.BAD_REQUEST, 'ADMIN_PASSWORD_WRONG', 'Current password is wrong');
    }
    await this.prisma.$transaction([
      this.prisma.administrator.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(input.newPassword) } }),
      // Sign out every other session.
      this.prisma.adminSession.updateMany({
        where: { adminId: admin.id, revokedAt: null, id: { not: admin.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({ adminId: admin.id, action: 'admin.password.change' });
  }

  async listAccounts() {
    const admins = await this.prisma.administrator.findMany({ orderBy: { createdAt: 'asc' } });
    return admins.map((admin) => ({
      ...publicAdmin(admin),
      disabled: Boolean(admin.disabledAt),
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      createdAt: admin.createdAt.toISOString(),
    }));
  }

  /** Creates an account and returns its one-time password; it is not stored or shown again. */
  async createAccount(input: AdminCreate, actorId: string | null) {
    const exists = await this.prisma.administrator.findUnique({ where: { username: input.username } });
    if (exists) throw apiError(HttpStatus.CONFLICT, 'ADMIN_USERNAME_TAKEN', 'Username already exists');
    const password = generatePassword();
    const admin = await this.prisma.administrator.create({ data: { ...input, passwordHash: await hashPassword(password) } });
    await this.audit.log({
      adminId: actorId,
      action: 'admin.account.create',
      targetType: 'administrator',
      targetId: admin.id,
      detail: { username: admin.username, role: admin.role },
    });
    return { admin: publicAdmin(admin), password };
  }

  async resetPassword(adminId: string, actor: AdminUser) {
    const password = generatePassword();
    await this.prisma.$transaction([
      this.prisma.administrator.update({ where: { id: adminId }, data: { passwordHash: await hashPassword(password) } }),
      this.prisma.adminSession.updateMany({ where: { adminId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ adminId: actor.id, action: 'admin.account.resetPassword', targetType: 'administrator', targetId: adminId });
    return { password };
  }

  async setDisabled(adminId: string, disabled: boolean, actor: AdminUser) {
    if (adminId === actor.id) throw apiError(HttpStatus.CONFLICT, 'ADMIN_CANNOT_DISABLE_SELF', 'You cannot disable yourself');
    await this.prisma.$transaction([
      this.prisma.administrator.update({ where: { id: adminId }, data: { disabledAt: disabled ? new Date() : null } }),
      ...(disabled ? [this.prisma.adminSession.updateMany({ where: { adminId, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
    ]);
    await this.audit.log({
      adminId: actor.id,
      action: disabled ? 'admin.account.disable' : 'admin.account.enable',
      targetType: 'administrator',
      targetId: adminId,
    });
    return this.listAccounts();
  }
}
