import { HttpStatus, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { apiError } from './errors';

/** Validates and normalizes a request body or query with a schema from @masterdriver/shared. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Request is invalid', {
        issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return result.data;
  }
}
