import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import { RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { EnvironmentService } from './config/environment.service.js';
import { REQUEST_ID_HEADER } from './common/redaction.js';
import { resolveRequestId } from './logger.js';

export const GLOBAL_PREFIX = 'api/v1';
export const OPENAPI_PATH = 'api/docs';

/** Matches the `bodyLimit` the Fastify adapter was configured with. */
export const BODY_LIMIT = '1mb';
export const RATE_LIMIT_MAX = 300;
export const RATE_LIMIT_WINDOW_MS = 60_000;

type HttpApplication = NestExpressApplication;

/**
 * Assigns every request an id up front and echoes it on the response, which is
 * what Fastify's `genReqId` did. It has to run before every other middleware so
 * that a rejection from helmet or the rate limiter is still traceable.
 */
export const requestIdMiddleware = (): RequestHandler => (request: Request, response: Response, next: NextFunction) => {
  const id = resolveRequestId(request.headers);
  request.requestId = id;
  response.setHeader(REQUEST_ID_HEADER, id);
  next();
};

/**
 * Fixed-window per-IP rate limit standing in for @fastify/rate-limit, with the
 * same budget (300 requests per minute) and the same key (the client IP). A
 * single process is the deployment target, so an in-memory counter is enough;
 * it is exported separately so the limit can be exercised in a test.
 */
export const createRateLimitMiddleware = (max: number, windowMs: number): RequestHandler => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (request: Request, response: Response, next: NextFunction) => {
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    const current = entry === undefined || entry.resetAt <= now ? { count: 0, resetAt: now + windowMs } : entry;
    current.count += 1;
    hits.set(key, current);
    response.setHeader('X-RateLimit-Limit', max);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, max - current.count));
    if (current.count > max) {
      response.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      response.status(429).type('application/problem+json').send({
        type: 'https://smart-home.local/problems/rate-limited',
        title: 'Too Many Requests',
        status: 429,
        code: 'RATE_LIMITED',
        detail: `Rate limit of ${max} requests per ${Math.round(windowMs / 1000)} seconds exceeded`,
        instance: request.url,
        requestId: request.requestId,
        errors: []
      });
      return;
    }
    next();
  };
};

/**
 * Middleware that must be in place before routes are served. Shared by the
 * entrypoint and the integration harness so tests cannot run against a surface
 * the production process never has.
 */
export const registerHttpPlugins = async (app: HttpApplication, environment: EnvironmentService): Promise<void> => {
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', true);
  express.use(requestIdMiddleware());
  express.use(helmet({ contentSecurityPolicy: false }));
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  app.use(createRateLimitMiddleware(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS));
  void environment;
};

/**
 * The OpenAPI document definition, shared by `configureHttpApp` and the
 * api-surface snapshot script so the two can never drift: a snapshot taken
 * against a separately built document would not notice a change to the
 * description, tags or server list.
 */
export const buildOpenApiConfig = (): Omit<OpenAPIObject, 'paths'> => new DocumentBuilder()
    .setTitle('Smart Home Maintenance Services API')
    .setDescription(
      [
        'The backend API for the Smart Home Maintenance Service platform: account sign-up and login, admin settings, payment webhooks, and health checks.',
        '',
        '**Getting started:** most endpoints need you to be logged in. Call `POST /auth/login` (password) or the OTP endpoints to get an `accessToken`, then click "Authorize" above and enter it as `Bearer <token>` to unlock the endpoints marked with a lock icon.',
        '',
        'Endpoints under **development** only work when the API is running with `DEV_INBOX_ENABLED=true` (local/dev setups) — they let you see the text messages, emails and files the mock providers would otherwise send to real services, which is how you retrieve OTP codes while testing.'
      ].join('\n')
    )
    .setVersion('1.0.0')
    .addTag('health', 'Check whether the API and the services it depends on (database, cache, background queues, file storage) are up and responding.')
    .addTag('catalogue', 'Browse service categories and bookable services, and (admin) manage them, commission rates, and which providers are approved to offer which service.')
    .addTag('places', 'Look up the cities and areas the platform operates in — use an area id when creating a customer address.')
    .addTag('customer', 'Actions for a signed-in customer account, such as managing saved addresses.')
    .addTag('provider', 'Actions for a signed-in service-provider account: profile, weekly availability, leave, and which areas they serve.')
    .addTag('search', "Find approved providers for a service near a point, and view a provider's public profile.")
    .addTag('booking', 'Request a provider for a service and carry the job through to completion: accept/decline, cancel/reschedule, arrival OTP, checklist, quote revisions, and finishing the job.')
    .addTag('auth', 'Sign up, log in, and manage your account: passwords, one-time verification codes (OTP), sessions, and two-factor authentication (TOTP).')
    .addTag('settings', 'Admin only. View and change platform-wide configuration values. Requires an ADMIN account with two-factor authentication turned on.')
    .addTag('webhooks', "Called automatically by external providers (e.g. the payment gateway) to report events. Not meant to be called directly by client apps.")
    .addTag('development', 'Local/dev-only helpers for inspecting what the mock SMS, email and file-storage providers received, so flows like OTP login can be tested without real providers. Disabled in production.')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addServer('/')
    .build();

/**
 * Everything that shapes the HTTP surface, shared by the real entrypoint and the
 * integration harness so the tests cannot exercise a different routing setup
 * than production.
 */
export const configureHttpApp = (app: HttpApplication, environment: EnvironmentService): void => {
  app.setGlobalPrefix(GLOBAL_PREFIX, {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'health/{*path}', method: RequestMethod.GET },
      { path: 'api/docs/{*path}', method: RequestMethod.GET }
    ]
  });
  app.enableCors({ origin: environment.values.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  SwaggerModule.setup(OPENAPI_PATH, app, document, { jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`, swaggerOptions: { persistAuthorization: true } });
};
