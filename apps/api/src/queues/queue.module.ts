import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../database/redis.module.js';

export const queueNames = ['notifications', 'payments', 'verification', 'projections', 'outbox'] as const;
export type QueueName = typeof queueNames[number];

@Injectable()
export class QueueRegistry implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(redis: RedisService) {
    for (const name of queueNames) this.queues.set(name, new Queue(name, { connection: redis.client.duplicate() }));
  }

  get(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map(queue => queue.close()));
  }
}

@Global()
@Module({ providers: [QueueRegistry], exports: [QueueRegistry] })
export class QueueModule {}
