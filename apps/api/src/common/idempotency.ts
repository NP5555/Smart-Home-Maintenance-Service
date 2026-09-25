import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { DomainError } from './domain-error.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_MIN_LENGTH = 8;
export const IDEMPOTENCY_MAX_LENGTH = 200;

export type IdempotentRequestInput = { key: string; userId: string; method: string; path: string; body: unknown };

export type IdempotencyRecord = { replayed: boolean; statusCode: number; response: Prisma.JsonValue | null };

export const requestFingerprint = (method: string, path: string, body: unknown): string =>
  createHash('sha256')
    .update(`${method.toUpperCase()} ${path}\n${body === undefined ? '' : JSON.stringify(body)}`)
    .digest('hex');

export const validateIdempotencyKey = (value: string | undefined): string => {
  if (value === undefined || value.trim().length === 0) throw new DomainError('IDEMPOTENCY_REQUIRED', 'The Idempotency-Key header is required for this operation');
  const key = value.trim();
  if (key.length < IDEMPOTENCY_MIN_LENGTH || key.length > IDEMPOTENCY_MAX_LENGTH) {
    throw new DomainError('BAD_REQUEST', `Idempotency-Key must be between ${IDEMPOTENCY_MIN_LENGTH} and ${IDEMPOTENCY_MAX_LENGTH} characters`);
  }
  return key;
};

export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed';
