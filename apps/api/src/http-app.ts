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
    .setDescription('Backend foundation: identity, health, platform settings, signed webhooks and mock integration adapters.')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addServer(`/${GLOBAL_PREFIX}`)
    .build();
  SwaggerModule.setup(OPENAPI_PATH, app, SwaggerModule.createDocument(app, openApi), { jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`, swaggerOptions: { persistAuthorization: true } });
};
