import { Injectable, Optional, type ModuleRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActorRole } from '../common/policy.js';
import { PrismaService } from '../database/prisma.service.js';
import type { QueueName } from '../queues/queue.registry.js';

export type AuditRequestContext = { requestId?: string | undefined; ip?: string | undefined; userAgent?: string | undefined };

export type AuditEntry = {
  actorUserId: string | null;
  actorRole: ActorRole | 'SYSTEM';
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
} & AuditRequestContext;

export type AuditSink = (entry: AuditEntry) => Promise<void>;

export const AUDIT_SINK = 'AUDIT_SINK';

export type DatabaseWriter = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly moduleRef?: ModuleRef
  ) {}

  async append(entry: AuditEntry, client: DatabaseWriter = this.prisma): Promise<void> {
    const sink = this.resolveSink();
    if (sink !== undefined) {
      await sink(entry);
      return;
    }
    await this.writeToDatabase(entry, client);
  }

  private resolveSink(): AuditSink | undefined {
    if (this.moduleRef === undefined) return undefined;
    try {
      return this.moduleRef.get<AuditSink>(AUDIT_SINK, { strict: false });
    } catch {
      return undefined;
    }
  }

  private async writeToDatabase(entry: AuditEntry, client: DatabaseWriter): Promise<void> {
    await client.$executeRaw(
      Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id, before, after, ip, user_agent, request_id)
        VALUES (${entry.actorUserId}::uuid, ${entry.actorRole}::actor_role, ${entry.action}, ${entry.entityType}, ${entry.entityId},
          ${JSON.stringify(entry.before ?? null)}::jsonb, ${JSON.stringify(entry.after ?? null)}::jsonb,
          ${entry.ip === undefined || entry.ip === null ? null : entry.ip}::inet, ${entry.userAgent ?? null}, ${entry.requestId ?? null})`
    );
  }
}

export const createInMemoryAuditSink = (): { sink: AuditSink; entries: AuditEntry[] } => {
  const entries: AuditEntry[] = [];
  return { entries, sink: entry => Promise.resolve(entries.push(entry)).then(() => undefined) };
};

export const outboxQueueFor = (eventType: string): QueueName => {
  if (eventType.startsWith('payment.') || eventType.startsWith('payout.') || eventType.startsWith('refund.')) return 'payments';
  if (eventType.startsWith('verification.')) return 'verification';
  if (eventType.startsWith('notification.') || eventType.includes('.notify')) return 'notifications';
  return 'projections';
};

export const appendOutboxEvent = async (client: DatabaseWriter, event: { aggregate: string; aggregateId: string; type: string; payload: Prisma.InputJsonValue }): Promise<void> => {
  await client.$executeRaw(
    Prisma.sql`INSERT INTO outbox_events(aggregate, aggregate_id, type, payload) VALUES (${event.aggregate}, ${event.aggregateId}, ${event.type}, ${JSON.stringify(event.payload)}::jsonb)`
  );
};
