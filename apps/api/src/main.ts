import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { EnvironmentService } from './config/environment.service.js';
import { configureHttpApp, registerHttpPlugins, GLOBAL_PREFIX, OPENAPI_PATH } from './http-app.js';
import { buildLoggerOptions, resolveRequestId } from './logger.js';
import { SettingsService } from './platform/settings.service.js';

export { GLOBAL_PREFIX, OPENAPI_PATH };

export const createHttpAdapter = (logLevel: string, isProduction: boolean): FastifyAdapter =>
  new FastifyAdapter({
    logger: buildLoggerOptions(logLevel, isProduction),
    genReqId: (request: IncomingMessage) => resolveRequestId(request.headers),
    bodyLimit: 1_048_576,
    trustProxy: true
  });

export const bootstrap = async (): Promise<NestFastifyApplication> => {
  const environment = new EnvironmentService();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createHttpAdapter(environment.values.LOG_LEVEL, environment.isProduction), { bufferLogs: true });

  await registerHttpPlugins(app, environment);
  configureHttpApp(app, environment);

  await app.get(SettingsService).start();
  await app.listen({ port: environment.values.PORT, host: environment.values.API_HOST });
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
