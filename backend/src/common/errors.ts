import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes are stable strings the clients translate into user-facing text;
 * the message is for logs and developers only.
 */
export function apiError(status: HttpStatus, code: string, message = code, extra?: Record<string, unknown>) {
  return new HttpException({ code, message, ...extra }, status);
}
