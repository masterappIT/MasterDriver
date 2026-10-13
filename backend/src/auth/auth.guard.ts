import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { readCookie } from '../common/cookies';
import { apiError } from '../common/errors';
import { AuthService, type SessionUser } from './auth.service';

export const SESSION_COOKIE = 'md_session';

type AuthedRequest = Request & { user?: SessionUser };

/**
 * The token is read from the Authorization header first and the cookie second.
 * Clients keep it in both places because the WeChat browser sometimes clears one.
 */
function extractToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim() || undefined;
  return readCookie(request.headers.cookie, SESSION_COOKIE);
}

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) protected readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractToken(request);
    if (token) request.user = (await this.auth.resolveSession(token)) ?? undefined;
    return true;
  }
}

@Injectable()
export class AuthGuard extends OptionalAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    if (!context.switchToHttp().getRequest<AuthedRequest>().user) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'SIGN_IN_REQUIRED', 'Sign in required');
    }
    return true;
  }
}

/** The signed-in user; undefined on routes guarded by OptionalAuthGuard when nobody is signed in. */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthedRequest>().user,
);
