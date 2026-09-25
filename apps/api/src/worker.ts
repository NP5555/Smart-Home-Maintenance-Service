import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { OutboxDispatcher } from './platform/outbox.dispatcher.js';
import { QueueRegistry, queueNames } from './queues/queue.module.js';

const bootstrap = async () => {
  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  context.get(OutboxDispatcher).start();
  const queues = context.get(QueueRegistry);
  const repeatables: { name: string; every: number }[] = [
    { name: 'outbox.dispatch', every: 1_000 },
    { name: 'verification.sla-monitor', every: 60_000 },
    { name: 'verification.lock-sweeper', every: 60_000 },
    { name: 'verification.auto-release', every: 300_000 },
    { name: 'ledger.reconcile', every: 86_400_000 }
  ];
  for (const item of repeatables) await queues.get('outbox').add('repeatable', item, { jobId: `repeatable:${item.name}`, repeat: { every: item.every } });
  const shutdown = async () => {
    context.get(OutboxDispatcher).stop();
    await context.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
};

void bootstrap();
