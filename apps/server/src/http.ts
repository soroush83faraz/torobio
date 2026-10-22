import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

/**
 * Response envelope shared by every /api route (except /api/health, which is flat for monitors):
 *   success: { data: T }
 *   failure: { error: { code: string, messageFa: string } }
 * `messageFa` is always user-facing Persian. `code` is a stable machine-readable string.
 */
export interface ApiErrorBody {
  error: { code: string; messageFa: string };
}

export const ERRORS = {
  NOT_IMPLEMENTED: { status: 501, messageFa: 'این بخش هنوز آماده نیست.' },
  BAD_REQUEST: { status: 400, messageFa: 'درخواست نامعتبر است.' },
  BAD_URL: { status: 400, messageFa: 'نشانی درخواست نامعتبر است.' },
  INVALID_JSON: { status: 400, messageFa: 'قالب درخواست درست نیست.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, messageFa: 'نوع محتوای درخواست پذیرفته نمی‌شود.' },
  PAYLOAD_TOO_LARGE: { status: 413, messageFa: 'درخواست بیش از حد بزرگ است.' },
  NOT_FOUND: { status: 404, messageFa: 'موردی پیدا نشد.' },
  RATE_LIMITED: { status: 429, messageFa: 'درخواست‌ها زیاد بود؛ چند لحظه دیگر دوباره تلاش کنید.' },
  TIMEOUT: { status: 503, messageFa: 'پاسخ‌گویی طول کشید؛ دوباره تلاش کنید.' },
  DB_UNAVAILABLE: { status: 503, messageFa: 'داده‌های بازار هنوز در دسترس نیست.' },
  INTERNAL: { status: 500, messageFa: 'مشکلی پیش آمد؛ دوباره تلاش کنید.' },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    /** Optional override of the default Persian message. */
    public readonly messageFa?: string,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export function errorBody(code: ErrorCode, messageFa?: string): ApiErrorBody {
  return { error: { code, messageFa: messageFa ?? ERRORS[code].messageFa } };
}

export function sendError(reply: FastifyReply, code: ErrorCode, messageFa?: string): FastifyReply {
  return reply.code(ERRORS[code].status).send(errorBody(code, messageFa));
}

export function ok<T>(data: T): { data: T } {
  return { data };
}

/**
 * Validate untrusted input with zod. Throws AppError(BAD_REQUEST) on failure; the zod issues are
 * deliberately NOT echoed back or logged because they can contain user text.
 */
export function validate<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError('BAD_REQUEST');
  return r.data;
}
