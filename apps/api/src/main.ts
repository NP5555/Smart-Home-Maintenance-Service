import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { createHttpAdapter, type HttpApplication } from './adapter.js';
import { AppModule } from './app.module.js';
import { EnvironmentService } from './config/environment.service.js';
import { configureHttpApp, registerHttpPlugins, GLOBAL_PREFIX, OPENAPI_PATH } from './http-app.js';
import { JsonLogger, toNestLogLevel } from './logger.js';
import { SettingsService } from './platform/settings.service.js';

export { GLOBAL_PREFIX, OPENAPI_PATH };

export const bootstrap = async (): Promise<HttpApplication> => {
  const environment = new EnvironmentService();
  const app = await NestFactory.create<HttpApplication>(AppModule, createHttpAdapter(), {
    bufferLogs: true,
    // Gives every request a `rawBody` Buffer, which is what the payment webhook
    // hashes to verify the gateway's signature. It replaces the Fastify
    // preParsing hook that used to live in src/common/raw-body.ts.
    rawBody: true
  });
  app.useLogger(new JsonLogger({ level: toNestLogLevel(environment.values.LOG_LEVEL), isProduction: environment.isProduction }));

  await registerHttpPlugins(app, environment);
  configureHttpApp(app, environment);

  await app.get(SettingsService).start();
  await app.listen(environment.values.PORT, environment.values.API_HOST);
  return app;
};

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;

if (isEntrypoint) {
  void bootstrap().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}

export const newRequestId = (): string => randomUUID();
