import { RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { EnvironmentService } from './config/environment.service.js';
import { rawBodyPlugin } from './common/raw-body.js';

export const GLOBAL_PREFIX = 'api/v1';
export const OPENAPI_PATH = 'api/docs';

/**
 * Fastify plugins that must be in place before routes are served. Shared by the
 * entrypoint and the integration harness so tests cannot run against a surface
 * the production process never has.
 */
export const registerHttpPlugins = async (app: NestFastifyApplication, environment: EnvironmentService): Promise<void> => {
  await app.register(rawBodyPlugin);
  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cookie, { secret: environment.values.CSRF_SECRET });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', keyGenerator: request => request.ip });
};

/**
 * Everything that shapes the HTTP surface, shared by the real entrypoint and the
 * integration harness so the tests cannot exercise a different routing setup
 * than production.
 */
export const configureHttpApp = (app: NestFastifyApplication, environment: EnvironmentService): void => {
  app.setGlobalPrefix(GLOBAL_PREFIX, {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'health/{*path}', method: RequestMethod.GET },
      { path: 'api/docs/{*path}', method: RequestMethod.GET }
    ]
  });
  app.enableCors({ origin: environment.values.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
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
    .addServer(`/${GLOBAL_PREFIX}`)
    .build();
  SwaggerModule.setup(OPENAPI_PATH, app, SwaggerModule.createDocument(app, openApi), { jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`, swaggerOptions: { persistAuthorization: true } });
};
