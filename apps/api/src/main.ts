import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import type { IncomingMessage } from 'node:http';
import { AppModule } from './app.module.js';
import { EnvironmentService } from './config/environment.js';
import { loggerOptions } from './logger.js';

const bootstrap = async () => {
  const adapter = new FastifyAdapter({ logger: loggerOptions, genReqId: (request: IncomingMessage) => String(request.headers['x-request-id'] ?? randomUUID()) });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  const environment = app.get(EnvironmentService);
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: false, runFirst: true });
  await app.register(helmet, { global: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 100, timeWindow: '1 minute' });
  app.enableCors({ origin: environment.corsOrigins, credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: [{ path: '', method: RequestMethod.GET }, { path: 'health/(.*)', method: RequestMethod.GET }] });
  const openApi = new DocumentBuilder().setTitle('Smart Home Maintenance Services API').setDescription('Backend foundation').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi), { jsonDocumentUrl: 'api/docs/openapi.json' });
  app.enableShutdownHooks();
  await app.listen(environment.values.PORT, environment.values.API_HOST);
};

void bootstrap();
