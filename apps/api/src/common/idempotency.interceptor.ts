import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { firstValueFrom, from, type Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { DomainError } from './domain-error.js';
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER, validateIdempotencyKey } from './idempotency.js';
import { IdempotencyService, type IdempotentOperation } from './idempotency.service.js';
import type { AuthenticatedRequest } from './policy.js';

export const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type InterceptableRequest = AuthenticatedRequest & { body?: unknown; url: string };

export const idempotencyHeaderOf = (request: Request): string | undefined => {
  const value = request.headers[IDEMPOTENCY_HEADER];
  const header = Array.isArray(value) ? value[0] : value;
  return header;
};

export const shouldBeIdempotent = (request: Request): boolean => IDEMPOTENT_METHODS.has(request.method.toUpperCase());

/**
 * The matched route pattern, so two different bookings are scoped separately
 * while the same booking is recognised however its id is spelled. This was
 * Fastify's `routeOptions.url`; Express exposes the same thing as `route.path`.
 */
export const routePathOf = (request: InterceptableRequest): string => request.route?.path ?? request.originalUrl;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(IdempotencyService) private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<InterceptableRequest>();
    const rawKey = idempotencyHeaderOf(request);
    if (!shouldBeIdempotent(request) || rawKey === undefined) return next.handle();
    return from(this.execute(context, next, request, rawKey));
  }

  private async execute(context: ExecutionContext, next: CallHandler, request: InterceptableRequest, rawKey: string): Promise<unknown> {
    const key = validateIdempotencyKey(rawKey);
    const userId = request.principal?.userId;
    if (userId === undefined) throw new DomainError('UNAUTHENTICATED', 'Authentication is required before an idempotent request can be recorded');
    const operation: IdempotentOperation = { key, userId, method: request.method, path: routePathOf(request), body: request.body };
    const response = context.switchToHttp().getResponse<Response>();
    const record = await this.idempotency.begin(operation);
    if (record.replayed) {
      // The stored body is returned as the handler result and the status is set
      // on the response rather than writing the reply here. The Fastify version
      // could call `reply.send()` itself because Nest then saw `reply.sent` and
      // skipped writing; on Express, writing here and returning undefined makes
      // Nest call `res.send()` a second time, which throws ERR_HTTP_HEADERS_SENT
      // after the headers have gone out.
      response.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      response.status(record.statusCode);
      return record.response;
    }
    try {
      const result = await firstValueFrom(next.handle());
      if (response.headersSent) return undefined;
      await this.idempotency.complete(operation, response.statusCode, JSON.parse(JSON.stringify(result ?? null)) as never);
      response.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'false');
      return result;
    } catch (error) {
      await this.idempotency.abandon(operation);
      throw error;
    }
  }
}
