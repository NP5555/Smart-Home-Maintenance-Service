import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { firstValueFrom, from, type Observable } from 'rxjs';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { DomainError } from './domain-error.js';
import type { AuthenticatedRequest } from './policy.guard.js';

type StoredResponse = { statusCode: number; response: Prisma.JsonValue };
type IdempotentRequest = FastifyRequest & { method: string; url: string; body: unknown; user?: { id: string } };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.execute(context, next));
  }

  private async execute(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    if (context.getType() !== 'http') return firstValueFrom(next.handle());
    const request = context.switchToHttp().getRequest<IdempotentRequest>();
    const key = request.headers['idempotency-key'];
    if (key === undefined) return firstValueFrom(next.handle());
    if (typeof key !== 'string' || key.length < 8 || key.length > 200) throw new DomainError('BAD_REQUEST', 'Idempotency-Key must contain 8 to 200 characters');
    if (!request.user?.id) throw new DomainError('UNAUTHENTICATED', 'Authenticated user is required for idempotent requests');
    const requestHash = createHash('sha256').update(`${request.method}:${request.url}:${JSON.stringify(request.body)}`).digest('hex');
    try {
      await this.prisma.$executeRaw(Prisma.sql`INSERT INTO idempotency_keys(key, user_id, route, request_hash) VALUES (${key}, ${request.user.id}::uuid, ${request.method} ${request.url}, ${requestHash})`);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.$queryRaw<{ request_hash: string; response: Prisma.JsonValue }[]>(Prisma.sql`SELECT request_hash, response FROM idempotency_keys WHERE key = ${key} AND user_id = ${request.user.id}::uuid`);
      if (existing[0]?.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used with a different request');
      if (existing[0]?.response === null || existing[0] === undefined) throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'The original request is still in progress');
      return existing[0].response;
    }
    const response = await firstValueFrom(next.handle());
    await this.prisma.$executeRaw(Prisma.sql`UPDATE idempotency_keys SET response = ${JSON.stringify(response)}::jsonb, status_code = 200 WHERE key = ${key} AND user_id = ${request.user.id}::uuid`);
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return reply.status(200).send(response);
  }
}

export const newIdempotencyKey = (): string => randomUUID();
