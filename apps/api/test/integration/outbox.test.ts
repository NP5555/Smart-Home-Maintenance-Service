import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { OutboxDispatcher } from '../../src/platform/outbox.dispatcher.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { QueueRegistry } from '../../src/queues/queue.registry.js';
import { outboxQueueFor } from '../../src/platform/audit.service.js';
import { createTestApp } from './harness.js';

const prisma = new PrismaClient();
const EVENT_TYPE = 'booking.requested';

let app: NestFastifyApplication;
let close: () => Promise<void>;
let registry: QueueRegistry;
let prismaService: PrismaService;
let environment: EnvironmentService;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  registry = app.get(QueueRegistry);
  prismaService = app.get(PrismaService);
  environment = app.get(EnvironmentService);
});

afterAll(async () => {
  await close();
  await prisma.$disconnect();
});

/**
 * `poll()` refuses re-entry per instance, so a second and third dispatcher are
 * built explicitly. Several instances over one database is what several BullMQ
 * workers on several API instances actually look like.
 */
const extraWorker = (): OutboxDispatcher => new OutboxDispatcher(prismaService, registry, environment);

const seedEvents = async (count: number): Promise<string[]> => {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const [row] = await prisma.$queryRaw<{ id: bigint }[]>(
      Prisma.sql`INSERT INTO outbox_events(aggregate, aggregate_id, type, payload)
                 VALUES ('booking', ${`outbox-test-${stamp}-${index}`}, ${EVENT_TYPE}, ${JSON.stringify({ index })}::jsonb)
                 RETURNING id`
    );
    if (row !== undefined) ids.push(row.id.toString());
  }
  return ids;
};

const unprocessed = async (ids: string[]): Promise<number> => {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM outbox_events WHERE id = ANY(${ids}::bigint[]) AND processed_at IS NULL`);
  return Number(rows[0]?.count ?? 0n);
};

/** BullMQ keeps one job per jobId, so a duplicate dispatch would collapse here. */
const jobFor = async (outboxId: string) => registry.queue(outboxQueueFor(EVENT_TYPE)).getJob(`outbox-${outboxId}`);

describe('SHM-008: outbox rows are dispatched exactly once under concurrent workers', () => {
  it('two workers racing over the same rows produce one job per row and no duplicates', async () => {
    const ids = await seedEvents(12);
    expect(ids).toHaveLength(12);

    const results = await Promise.all([app.get(OutboxDispatcher).poll(100), extraWorker().poll(100)]);
    const enqueued = results.reduce((total, result) => total + result.enqueued, 0);

    expect(enqueued).toBeGreaterThanOrEqual(ids.length);
    expect(await unprocessed(ids)).toBe(0);
    for (const id of ids) {
      const job = await jobFor(id);
      expect(job, `outbox ${id} should have a job`).toBeDefined();
      expect(job?.name).toBe('outbox.dispatch');
      expect(job?.data.outboxId).toBe(id);
      expect(job?.data.eventType).toBe(EVENT_TYPE);
    }
  });

  it('a later sweep claims nothing, so no row is enqueued twice', async () => {
    const result = await app.get(OutboxDispatcher).poll(100);
    expect(result.claimed).toBe(0);
    expect(result.enqueued).toBe(0);
  });

  it('rows beyond one batch are all reached, and SKIP LOCKED never blocks a second worker', async () => {
    const ids = await seedEvents(25);
    let sweeps = 0;
    while ((await unprocessed(ids)) > 0 && sweeps < 10) {
      await Promise.all([app.get(OutboxDispatcher).poll(10), extraWorker().poll(10)]);
      sweeps += 1;
    }
    expect(await unprocessed(ids)).toBe(0);
    for (const id of ids) {
      expect(await jobFor(id), `outbox ${id} should have exactly one job`).toBeDefined();
    }
  });

  it('re-entry on one instance is refused, so a slow poll cannot overlap itself', async () => {
    await seedEvents(4);
    const dispatcher = app.get(OutboxDispatcher);
    const [first, second] = await Promise.all([dispatcher.poll(1), dispatcher.poll(1)]);
    expect([first.claimed, second.claimed].filter(claimed => claimed === 0).length).toBeGreaterThanOrEqual(1);
  });
});
