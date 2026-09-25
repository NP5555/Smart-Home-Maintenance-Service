import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module.js';
import { EnvironmentService } from './config/environment.service.js';
import { rawBodyPlugin } from './common/raw-body.js';
import { buildLoggerOptions, resolveRequestId } from './logger.js';
import { SettingsService } from './platform/settings.service.js';

export const GLOBAL_PREFIX = 'api/v1';
export const OPENAPI_PATH = 'api/docs';

export const createHttpAdapter = (logLevel: string, isProduction: boolean): FastifyAdapter =>
  new FastifyAdapter({
    logger: buildLoggerOptions(logLevel, isProduction),
    genReqId: (request: IncomingMessage) => resolveRequestId(request.headers),
    bodyLimit: 1_048_576,
    trustProxy: true,
    disableRequestLogging: false
  });

export const bootstrap = async (): Promise<NestFastifyApplication> => {
  const environment = new EnvironmentService();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createHttpAdapter(environment.values.LOG_LEVEL, environment.isProduction), { bufferLogs: true });

  await app.register(rawBodyPlugin);
  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cookie, { secret: environment.values.CSRF_SECRET });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', keyGenerator: request => request.ip });

  app.enableCors({ origin: environment.values.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [{ path: '', method: RequestMethod.GET }, { path: 'health/{*path}', method: RequestMethod.GET }, { path: 'api/docs/{*path}', method: RequestMethod.GET }] });
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('Smart Home Maintenance Services API')
    .setDescription('Backend foundation: health, platform settings, signed webhooks and mock integration adapters.')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addServer(`/${GLOBAL_PREFIX}`)
    .build();
  const document = SwaggerModule.createDocument(app, openApi);
  SwaggerModule.setup(OPENAPI_PATH, app, document, { jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`, swaggerOptions: { persistAuthorization: true } });

  await app.get(SettingsService).start();
  await app.listen({ port: environment.values.PORT, host: environment.values.API_HOST });
  return app;
};

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;

if (isEntrypoint) {
  void bootstrap().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}

export const newRequestId = (): string => randomUUID();
