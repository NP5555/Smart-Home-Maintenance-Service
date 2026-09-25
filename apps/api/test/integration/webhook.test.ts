import { createHmac, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { callApi, createTestApp, type ApiResponse } from './harness.js';

const prisma = new PrismaClient();
const WEBHOOK_URL = '/webhooks/payments/mock';

let app: NestFastifyApplication;
let close: () => Promise<void>;
let secret: string;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  secret = app.get(EnvironmentService).values.MOCK_PAYMENT_WEBHOOK_SECRET;
});

afterAll(async () => {
  await close();
  await prisma.$disconnect();
});

const sign = (timestamp: number, body: string, using = secret): string => createHmac('sha256', using).update(`${timestamp}.${body}`).digest('hex');

const event = (paymentId: string) => ({
  eventId: `evt_${randomUUID()}`,
  paymentId,
  type: 'payment.captured',
  occurredAt: new Date().toISOString(),
  payload: { amount: 50_000 }
});

type Deliver = { body: string; timestamp?: number; signedOver?: string; using?: string; omitSignature?: boolean; url?: string };

const deliver = async ({ body, timestamp = Date.now(), signedOver, using, omitSignature, url = WEBHOOK_URL }: Deliver): Promise<ApiResponse<{ code?: string; accepted?: boolean; duplicate?: boolean; eventId?: string }>> =>
  callApi(app, url, {
    method: 'POST',
    body,
    headers: {
      ...(omitSignature === true ? {} : { 'x-mock-signature': sign(timestamp, signedOver ?? body, using) }),
      ...(omitSignature === true ? {} : { 'x-mock-timestamp': String(timestamp) })
    }
  });

const seedPayment = async (): Promise<string> => {
  const [booking] = await prisma.$queryRaw<{ id: string; customer_id: string }[]>(Prisma.sql`SELECT id, customer_id FROM bookings LIMIT 1`);
  if (booking === undefined) throw new Error('no booking to attach a payment to; run the invariant suite first');
  const [row] = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`INSERT INTO payments(purpose, booking_id, payer_user_id, gateway, gateway_ref, amount_paisa, status, idempotency_key)
               VALUES ('BOOKING', ${booking.id}::uuid, ${booking.customer_id}::uuid, 'mock', ${`ref_${randomUUID()}`}, 50000, 'INITIATED', ${`idem_${randomUUID()}`})
               RETURNING id`
  );
  if (row === undefined) throw new Error('could not seed a payment');
  return row.id;
};

describe('TRD 18: the payment webhook verifies HMAC, tolerates replay and never 500s', () => {
  it('rejects a request with no signature headers', async () => {
    const response = await deliver({ body: JSON.stringify(event(randomUUID())), omitSignature: true });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a signature made with a different secret', async () => {
    const response = await deliver({ body: JSON.stringify(event(randomUUID())), using: 'a-different-secret' });
    expect(response.status).toBe(401);
  });

  it('rejects a timestamp outside the five minute tolerance', async () => {
    const stale = Date.now() - 600_000;
    const response = await deliver({ body: JSON.stringify(event(randomUUID())), timestamp: stale });
    expect(response.status).toBe(401);
  });

  it('rejects a body whose bytes differ from the ones that were signed', async () => {
    const delivered = JSON.stringify(event(randomUUID()));
    const tampered = `${delivered} `;
    const response = await deliver({ body: tampered, signedOver: delivered });
    expect(response.status).toBe(401);
  });

  it('rejects an unknown gateway before it looks at the signature', async () => {
    const body = JSON.stringify(event(randomUUID()));
    const response = await deliver({ body, url: '/webhooks/payments/stripe' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('accepts a valid signature for a real payment and dispatches an outbox event', async () => {
    const paymentId = await seedPayment();
    const response = await deliver({ body: JSON.stringify(event(paymentId)) });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ accepted: true, duplicate: false, matchedPayment: true });

    const events = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM outbox_events WHERE aggregate = 'payment' AND aggregate_id = ${paymentId}`);
    expect(Number(events[0]?.count ?? 0n)).toBeGreaterThanOrEqual(1);
  });

  it('is idempotent: replaying the same event id stores one row and reports duplicate', async () => {
    const paymentId = await seedPayment();
    const first = await deliver({ body: JSON.stringify(event(paymentId)) });
    expect(first.status).toBe(202);
    const eventId = first.body.eventId as string;

    const replay = await deliver({ body: JSON.stringify({ ...event(paymentId), eventId }) });
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({ accepted: true, duplicate: true });

    const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM payment_events WHERE gateway_event_id = ${eventId}`);
    expect(Number(rows[0]?.count ?? 0n)).toBe(1);
  });

  it('an authenticated event for a payment we do not have is recorded, not a 500', async () => {
    const unknown = randomUUID();
    const response = await deliver({ body: JSON.stringify(event(unknown)) });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ accepted: true, duplicate: false, matchedPayment: false });

    // payment_id is nullable precisely so the dedupe key still holds.
    const rows = await prisma.$queryRaw<{ payment_id: string | null }[]>(Prisma.sql`SELECT payment_id FROM payment_events WHERE gateway_event_id = ${response.body.eventId}`);
    expect(rows[0]?.payment_id).toBeNull();

    // Replaying the orphan is still deduplicated rather than duplicated.
    const replay = await deliver({ body: JSON.stringify({ ...event(unknown), eventId: response.body.eventId }) });
    expect(replay.body).toMatchObject({ accepted: true, duplicate: true });
  });
});
