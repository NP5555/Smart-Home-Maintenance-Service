import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { firstValueFrom, from, type Observable } from 'rxjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from './domain-error.js';
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER, validateIdempotencyKey } from './idempotency.js';
import { IdempotencyService, type IdempotentOperation } from './idempotency.service.js';
import type { AuthenticatedRequest } from './policy.js';

export const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type InterceptableRequest = AuthenticatedRequest & { body?: unknown; url: string };

export const idempotencyHeaderOf = (request: FastifyRequest): string | undefined => {
  const value = request.headers[IDEMPOTENCY_HEADER];
  const header = Array.isArray(value) ? value[0] : value;
  return header;
};

export const shouldBeIdempotent = (request: FastifyRequest): boolean => IDEMPOTENT_METHODS.has(request.method.toUpperCase());

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
    const operation: IdempotentOperation = { key, userId, method: request.method, path: request.routeOptions?.url ?? request.url, body: request.body };
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const record = await this.idempotency.begin(operation);
    if (record.replayed) {
      void reply.header(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      return reply.status(record.statusCode).send(record.response);
    }
    try {
      const response = await firstValueFrom(next.handle());
      if (reply.sent) return undefined;
      await this.idempotency.complete(operation, reply.statusCode, JSON.parse(JSON.stringify(response ?? null)) as never);
      void reply.header(IDEMPOTENCY_REPLAYED_HEADER, 'false');
      return response;
    } catch (error) {
      await this.idempotency.abandon(operation);
      throw error;
    }
  }
}
