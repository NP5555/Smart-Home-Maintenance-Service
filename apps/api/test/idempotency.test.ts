import { describe, expect, it } from 'vitest';
import { IDEMPOTENT_METHODS, idempotencyHeaderOf, shouldBeIdempotent } from '../src/common/idempotency.interceptor.js';
import { IDEMPOTENCY_MAX_LENGTH, IDEMPOTENCY_MIN_LENGTH, IDEMPOTENCY_REPLAYED_HEADER, requestFingerprint, validateIdempotencyKey } from '../src/common/idempotency.js';
import { DomainError } from '../src/common/domain-error.js';
import { outboxQueueFor } from '../src/platform/audit.service.js';
import { QUEUE_NAMES, REPEATABLE_JOBS } from '../src/queues/queue.registry.js';
import type { FastifyRequest } from 'fastify';

const request = (method: string, headers: Record<string, string> = {}): FastifyRequest => ({ method, headers }) as unknown as FastifyRequest;

describe('idempotency foundation (TRD §5.4)', () => {
  it('applies only to mutating methods', () => {
    expect([...IDEMPOTENT_METHODS].sort()).toEqual(['DELETE', 'PATCH', 'POST', 'PUT']);
    expect(shouldBeIdempotent(request('POST'))).toBe(true);
    expect(shouldBeIdempotent(request('GET'))).toBe(false);
  });

  it('reads the header case insensitively and requires a usable key when present', () => {
    expect(idempotencyHeaderOf(request('POST', { 'idempotency-key': 'abcdefgh' }))).toBe('abcdefgh');
    expect(idempotencyHeaderOf(request('POST'))).toBeUndefined();
    expect(validateIdempotencyKey('  abcdefgh  ')).toBe('abcdefgh');
  });

  it('rejects a missing or out of range key', () => {
    expect(() => validateIdempotencyKey(undefined)).toThrow(DomainError);
    expect(() => validateIdempotencyKey('a'.repeat(IDEMPOTENCY_MIN_LENGTH - 1))).toThrow(DomainError);
    expect(() => validateIdempotencyKey('a'.repeat(IDEMPOTENCY_MAX_LENGTH + 1))).toThrow(DomainError);
  });

  it('fingerprints the method, path and body so a replay with a different body is detected', () => {
    const first = requestFingerprint('POST', '/api/v1/bookings/checkout', { slot: 'a' });
    expect(requestFingerprint('POST', '/api/v1/bookings/checkout', { slot: 'a' })).toBe(first);
    expect(requestFingerprint('POST', '/api/v1/bookings/checkout', { slot: 'b' })).not.toBe(first);
    expect(requestFingerprint('PUT', '/api/v1/bookings/checkout', { slot: 'a' })).not.toBe(first);
  });

  it('marks a replayed response with a dedicated header', () => {
    expect(IDEMPOTENCY_REPLAYED_HEADER).toBe('idempotency-replayed');
  });
});

describe('outbox routing', () => {
  it('routes every outbox event type to a registered queue', () => {
    expect(outboxQueueFor('payment.captured')).toBe('payments');
    expect(outboxQueueFor('payout.settled')).toBe('payments');
    expect(outboxQueueFor('verification.queued')).toBe('verification');
    expect(outboxQueueFor('notification.send')).toBe('notifications');
    expect(outboxQueueFor('booking.transitioned')).toBe('projections');
    expect(outboxQueueFor('anything.else')).toBe('projections');
    for (const type of ['payment.captured', 'verification.queued', 'notification.send', 'booking.transitioned']) {
      expect(QUEUE_NAMES).toContain(outboxQueueFor(type));
    }
  });
});

describe('repeatable job catalogue (TRD §13)', () => {
  it('registers the foundation repeatables with fixed job ids and known cadences', () => {
    const byName = new Map(REPEATABLE_JOBS.map(job => [job.name, job]));
    expect(byName.get('outbox.dispatch')?.everyMs).toBe(1_000);
    expect(byName.get('verification.sla-monitor')?.everyMs).toBe(60_000);
    expect(byName.get('verification.lock-sweeper')?.everyMs).toBe(60_000);
    expect(byName.get('verification.auto-release')?.everyMs).toBe(300_000);
    expect(byName.get('ledger.reconcile')?.everyMs).toBe(86_400_000);
    for (const job of REPEATABLE_JOBS) expect(QUEUE_NAMES).toContain(job.queue);
  });
});
