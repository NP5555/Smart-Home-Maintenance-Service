import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { QueueRegistry, type QueueName } from '../queues/queue.module.js';

type OutboxRow = { id: bigint; type: string; payload: Prisma.JsonValue };
const queueByPrefix: Record<string, QueueName> = { 'payment.': 'payments', 'verification.': 'verification', 'notification.': 'notifications', 'booking.': 'projections' };

@Injectable()
export class OutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(private readonly prisma: PrismaService, private readonly queues: QueueRegistry) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async poll(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    try {
      return await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`SELECT id, type, payload FROM outbox_events WHERE processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100`);
        for (const row of rows) {
          const prefix = row.type.split('.').slice(0, 1).join('.');
          const queue = queueByPrefix[prefix] ?? 'notifications';
          await this.queues.get(queue).add('dispatch', { outboxId: row.id.toString(), type: row.type, payload: row.payload }, { jobId: `outbox-${row.id}` });
          await tx.$executeRaw(Prisma.sql`UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1 WHERE id = ${row.id}`);
        }
        return rows.length;
      });
    } finally {
      this.polling = false;
    }
  }
}
