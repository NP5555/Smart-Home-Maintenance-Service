import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { buildLoggerOptions } from './logger.js';
import { EnvironmentService } from './config/environment.service.js';
import { OutboxDispatcher } from './platform/outbox.dispatcher.js';
import { SettingsService } from './platform/settings.service.js';
import { QueueRegistry, REPEATABLE_JOBS } from './queues/queue.registry.js';

export const startWorker = async (): Promise<void> => {
  const environment = new EnvironmentService();
  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true, logger: buildLoggerOptions(environment.values.LOG_LEVEL, environment.isProduction) });
  const settings = context.get(SettingsService);
  await settings.start();
  const queues = context.get(QueueRegistry);
  const dispatcher = context.get(OutboxDispatcher);
  dispatcher.stop();
  for (const job of REPEATABLE_JOBS) {
    await queues.queue(job.queue).add('repeatable.schedule', { name: job.name, everyMs: job.everyMs }, { jobId: `repeatable:${job.name}`, repeat: { every: job.everyMs } });
  }
  for (const name of new Set(REPEATABLE_JOBS.map(job => job.queue))) {
    await queues.startWorker(name);
  }
  const shutdown = async (signal: string): Promise<void> => {
    context.get(OutboxDispatcher).stop();
    await settings.stop();
    await context.close();
    process.stdout.write(`worker received ${signal} and shut down cleanly\n`);
  };
  process.once('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));
};

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;

if (isEntrypoint) {
  void startWorker().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
