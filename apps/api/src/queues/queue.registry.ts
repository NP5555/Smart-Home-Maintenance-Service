import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { RedisService } from '../database/redis.module.js';

export const QUEUE_NAMES = ['outbox', 'notifications', 'payments', 'verification', 'projections'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export const REPEATABLE_JOBS: readonly { name: string; queue: QueueName; everyMs: number }[] = [
  { name: 'outbox.dispatch', queue: 'outbox', everyMs: 1_000 },
  { name: 'verification.sla-monitor', queue: 'verification', everyMs: 60_000 },
  { name: 'verification.lock-sweeper', queue: 'verification', everyMs: 60_000 },
  { name: 'verification.auto-release', queue: 'verification', everyMs: 300_000 },
  { name: 'ledger.reconcile', queue: 'projections', everyMs: 86_400_000 }
];

export type QueueHandler = (data: Record<string, unknown>) => Promise<void>;

@Injectable()
export class QueueRegistry implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers = new Map<QueueName, Worker>();
  private readonly events = new Map<QueueName, QueueEvents>();
  private readonly handlers = new Map<string, QueueHandler>();

  constructor(@Inject(RedisService) private readonly redis: RedisService) {
    for (const name of QUEUE_NAMES) this.queues.set(name, new Queue(name, { connection: this.redis.duplicate() }));
  }

  queue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (queue === undefined) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }

  registerHandler(jobName: string, handler: QueueHandler): void {
    this.handlers.set(jobName, handler);
  }

  async enqueue(queue: QueueName, jobName: string, data: Record<string, unknown>, jobId: string, delayMs = 0): Promise<string> {
    const job = await this.queue(queue).add(jobName, data, { jobId, delay: delayMs, removeOnComplete: 1_000, removeOnFail: 5_000, attempts: 5, backoff: { type: 'exponential', delay: 30_000 } });
    return job.id ?? jobId;
  }

  async startWorker(queue: QueueName): Promise<void> {
    if (this.workers.has(queue)) return;
    const worker = new Worker(queue, async job => {
      const handler = this.handlers.get(job.name);
      if (handler !== undefined) await handler(job.data as Record<string, unknown>);
    }, { connection: this.redis.duplicate(), concurrency: 8 });
    const events = new QueueEvents(queue, { connection: this.redis.duplicate() });
    await events.waitUntilReady();
    this.workers.set(queue, worker);
    this.events.set(queue, events);
  }

  async depth(name: QueueName): Promise<number> {
    const counts = await this.queue(name).getJobCounts('waiting', 'active', 'delayed', 'failed');
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0);
  }

  async depths(): Promise<Record<QueueName, number>> {
    const entries = await Promise.all(
      QUEUE_NAMES.map(async name => {
        try {
          return [name, await this.depth(name)] as const;
        } catch {
          return [name, -1] as const;
        }
      })
    );
    return Object.fromEntries(entries) as Record<QueueName, number>;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.workers.values()].map(worker => worker.close()));
    await Promise.allSettled([...this.events.values()].map(events => events.close()));
    await Promise.allSettled([...this.queues.values()].map(queue => queue.close()));
  }
}

@Global()
@Module({
  providers: [QueueRegistry],
  exports: [QueueRegistry]
})
export class QueueModule {}
