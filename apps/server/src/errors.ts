import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Socket } from 'node:net';
import { sanitizeDeep } from '@app/core';
import { DbUnavailableError } from './db.js';
import { AppError, ERRORS, errorBody, type ErrorCode } from './http.js';
import { isHtmlRequest, sendOfflinePage } from './web.js';

/**
 * Every error the server can produce, from our handlers to the framework's own (bad URL, oversized or malformed
 * body, wrong media type, static-file path problems, socket-level parse errors), leaves as the Persian envelope
 * { error: { code, messageFa } }. Messages are fixed text: never the request path, the body or an exception message.
 */
export function mapError(err: FastifyError | AppError | Error): ErrorCode {
  if (err instanceof AppError) return err.code;
  if (err instanceof DbUnavailableError) return 'DB_UNAVAILABLE';
  const e = err as FastifyError;
  switch (e.code) {
    case 'FST_ERR_BAD_URL':
      return 'BAD_URL';
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return 'PAYLOAD_TOO_LARGE';
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
    case 'FST_ERR_CTP_INVALID_HANDLER':
      return 'INVALID_JSON';
    case 'FST_ERR_VALIDATION':
      return 'BAD_REQUEST';
    case 'FST_ERR_HANDLER_TIMEOUT':
      return 'TIMEOUT';
  }
  const status = e.statusCode;
  if (status === 429) return 'RATE_LIMITED';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  // Static-file problems (a path that climbs out of the web root, a bad range...) are "no such file".
  if (status === 403 || status === 404 || status === 410 || status === 416) return 'NOT_FOUND';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'INTERNAL';
}

/** Errors raised before routing (Fastify `frameworkErrors`): FST_ERR_BAD_URL and similar. */
export function frameworkErrors(error: FastifyError, _req: FastifyRequest, reply: FastifyReply): void {
  const code = mapError(error);
  void reply.code(ERRORS[code].status).header('Cache-Control', 'no-store').send(errorBody(code));
}

/** Errors the HTTP parser rejects before any request exists (Fastify `clientErrorHandler`). */
export function clientErrorHandler(err: NodeJS.ErrnoException, socket: Socket): void {
  if (err.code === 'ECONNRESET' || socket.destroyed || !socket.writable) {
    socket.destroy();
    return;
  }
  const timeout = err.code === 'ERR_HTTP_REQUEST_TIMEOUT';
  const code: ErrorCode = timeout ? 'TIMEOUT' : 'BAD_REQUEST';
  const status = timeout ? 408 : 400;
  const body = JSON.stringify(errorBody(code));
  socket.end(
    `HTTP/1.1 ${status} ${timeout ? 'Request Timeout' : 'Bad Request'}\r\n` +
      'Connection: close\r\nContent-Type: application/json; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

/**
 * Error handler for everything that reaches a route or hook. A 5xx on a browser page load (not /api) is the
 * static Persian "problem, try again" page; everything else is the JSON envelope with the original status.
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error, req, reply) => {
    const code = mapError(err);
    const { status } = ERRORS[code];
    if (status >= 500 && code !== 'DB_UNAVAILABLE') req.log.error({ code, errName: err.name }, 'request failed');
    else req.log.info({ code }, 'request rejected');
    if (status >= 500 && isHtmlRequest(req)) return sendOfflinePage(reply, status);
    return reply.code(status).send(errorBody(code, err instanceof AppError ? err.messageFa : undefined));
  });
}

/**
 * Strips bidi-override / control characters from every string in a JSON request body for /api/*, before
 * validation, so no route, state field, share link or LLM prompt ever sees them.
 */
export function installBodySanitizer(app: FastifyInstance): void {
  app.addHook('preValidation', async (req) => {
    if (req.body !== null && typeof req.body === 'object' && req.url.startsWith('/api/')) req.body = sanitizeDeep(req.body);
  });
}
