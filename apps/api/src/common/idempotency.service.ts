import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { DomainError } from './domain-error.js';
import { requestFingerprint, type IdempotencyRecord } from './idempotency.js';

export type IdempotentOperation = { key: string; userId: string; method: string; path: string; body: unknown };

export const beginIdempotentOperation = async (prisma: PrismaService, operation: IdempotentOperation): Promise<IdempotencyRecord> => {
  const fingerprint = requestFingerprint(operation.method, operation.path, operation.body);
  const route = `${operation.method.toUpperCase()} ${operation.path}`;
  try {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO idempotency_keys(key, user_id, route, request_hash) VALUES (${operation.key}, ${operation.userId}::uuid, ${route}, ${fingerprint})`
    );
    return { replayed: false, statusCode: 0, response: null };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await prisma.$queryRaw<{ request_hash: string; status_code: number | null; response: Prisma.JsonValue | null }[]>(
      Prisma.sql`SELECT request_hash, status_code, response FROM idempotency_keys WHERE key = ${operation.key} AND user_id = ${operation.userId}::uuid`
    );
    const row = existing[0];
    if (row === undefined) throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'The original request is still in progress');
    if (row.request_hash !== fingerprint) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used with a different request body');
    if (row.response === null) throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'The original request is still in progress');
    return { replayed: true, statusCode: row.status_code ?? 200, response: row.response };
  }
};

export const completeIdempotentOperation = async (prisma: PrismaService, operation: IdempotentOperation, statusCode: number, response: Prisma.InputJsonValue): Promise<void> => {
  await prisma.$executeRaw(
    Prisma.sql`UPDATE idempotency_keys SET status_code = ${statusCode}, response = ${JSON.stringify(response)}::jsonb WHERE key = ${operation.key} AND user_id = ${operation.userId}::uuid`
  );
};

export const abandonIdempotentOperation = async (prisma: PrismaService, operation: IdempotentOperation): Promise<void> => {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM idempotency_keys WHERE key = ${operation.key} AND user_id = ${operation.userId}::uuid AND response IS NULL`);
};

@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  begin(operation: IdempotentOperation): Promise<IdempotencyRecord> {
    return beginIdempotentOperation(this.prisma, operation);
  }

  complete(operation: IdempotentOperation, statusCode: number, response: Prisma.InputJsonValue): Promise<void> {
    return completeIdempotentOperation(this.prisma, operation, statusCode, response);
  }

  abandon(operation: IdempotentOperation): Promise<void> {
    return abandonIdempotentOperation(this.prisma, operation);
  }
}

@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService]
})
export class IdempotencyModule {}
