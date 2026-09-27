import type { IncomingMessage } from 'node:http';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildLoggerOptions, resolveRequestId } from './logger.js';

export type HttpAdapter = FastifyAdapter;
export type HttpApplication = NestFastifyApplication;

export const createHttpAdapter = (logLevel: string, isProduction: boolean): HttpAdapter =>
  new FastifyAdapter({
    logger: buildLoggerOptions(logLevel, isProduction),
    genReqId: (request: IncomingMessage) => resolveRequestId(request.headers),
    bodyLimit: 1_048_576,
    trustProxy: true
  });
