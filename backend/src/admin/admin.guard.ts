import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@masterdriver/shared';
import type { Request } from 'express';
import { readCookie } from '../common/cookies';
import { apiError } from '../common/errors';
import { AdminAuthService, type AdminUser } from './admin-auth.service';

export const ADMIN_COOKIE = 'md_admin';
/** Sent by the admin app on every request; a cross-site form cannot set it. */
export const ADMIN_CSRF_HEADER = 'x-md-admin';

const ROLES_KEY = 'adminRoles';
/** Roles allowed on a route or controller. Without it, any signed-in admin may call. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

type AdminRequest = Request & { admin?: AdminUser };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (request.headers[ADMIN_CSRF_HEADER] !== '1') {
      throw apiError(HttpStatus.FORBIDDEN, 'ADMIN_HEADER_REQUIRED', 'Admin requests must come from the admin app');
    }
    const token = readCookie(request.headers.cookie, ADMIN_COOKIE);
    const admin = token ? await this.auth.resolveSession(token) : null;
    if (!admin) throw apiError(HttpStatus.UNAUTHORIZED, 'ADMIN_SIGN_IN_REQUIRED', 'Admin sign-in required');

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(admin.role)) {
      throw apiError(HttpStatus.FORBIDDEN, 'ADMIN_ROLE_FORBIDDEN', 'Your role cannot do this');
    }
    request.admin = admin;
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AdminRequest>().admin,
);
