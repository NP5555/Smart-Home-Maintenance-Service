# Review package — Task 2 (no-git adaptation: full contents of touched files, not a diff)

## Files touched
- Created: apps/api/src/booking/booking.schemas.ts
- Created: apps/api/src/booking/booking.service.ts
- Created: apps/api/src/booking/booking.controller.ts
- Created: apps/api/src/booking/booking.module.ts
- Created: apps/api/test/integration/booking.test.ts
- Modified: apps/api/src/app.module.ts
- Modified: apps/api/src/http-app.ts
- Modified: apps/api/test/integration/harness.ts

## File: apps/api/src/booking/booking.schemas.ts
```typescript
// apps/api/src/booking/booking.schemas.ts
import { z } from 'zod';

export const bookingCreateSchema = z
  .object({
    providerId: z.string().uuid(),
    serviceId: z.number().int().positive(),
    addressId: z.string().uuid(),
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime(),
    problemText: z.string().trim().min(1).max(2000).optional()
  })
  .strict()
  .refine(input => new Date(input.scheduledEnd).getTime() > new Date(input.scheduledStart).getTime(), { message: 'scheduledEnd must be after scheduledStart', path: ['scheduledEnd'] });

export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
```

## File: apps/api/src/booking/booking.service.ts
```typescript
// apps/api/src/booking/booking.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { wallTimeIn } from '@smart-home/domain';
import { badRequest, conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { BookingCreateInput } from './booking.schemas.js';

export type BookingRow = {
  id: string;
  code: string;
  customerId: string;
  providerId: string | null;
  serviceId: number;
  addressId: string;
  status: string;
  paymentMode: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  problemText: string | null;
  quotedAmountPaisa: number;
  approvedTotalPaisa: number;
  finalAmountPaisa: number | null;
  rescheduleCount: number;
  noShowParty: string | null;
  cancelReason: string | null;
  startOtpVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BookingRowRaw = Omit<BookingRow, 'quotedAmountPaisa' | 'approvedTotalPaisa' | 'finalAmountPaisa'> & {
  quotedAmountPaisa: bigint;
  approvedTotalPaisa: bigint;
  finalAmountPaisa: bigint | null;
};

export const BOOKING_COLUMNS = Prisma.sql`id, code, customer_id as "customerId", provider_id as "providerId", service_id as "serviceId", address_id as "addressId",
  status, payment_mode as "paymentMode", scheduled_start as "scheduledStart", scheduled_end as "scheduledEnd", problem_text as "problemText",
  quoted_amount_paisa as "quotedAmountPaisa", approved_total_paisa as "approvedTotalPaisa", final_amount_paisa as "finalAmountPaisa",
  reschedule_count as "rescheduleCount", no_show_party as "noShowParty", cancel_reason as "cancelReason", start_otp_verified_at as "startOtpVerifiedAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

export const toBookingRow = (raw: BookingRowRaw): BookingRow => ({
  ...raw,
  quotedAmountPaisa: Number(raw.quotedAmountPaisa),
  approvedTotalPaisa: Number(raw.approvedTotalPaisa),
  finalAmountPaisa: raw.finalAmountPaisa === null ? null : Number(raw.finalAmountPaisa)
});

const EXCLUSION_VIOLATION = '23P01';

/** local calendar-day weekday (0=Sunday) in Asia/Karachi, matching provider_availability.weekday's convention */
const localWeekday = (instant: Date): number => {
  const wall = wallTimeIn(instant);
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
};

const localTimeOfDay = (instant: Date): string => {
  const wall = wallTimeIn(instant);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}:00`;
};

@Injectable()
export class BookingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(customerId: string, input: BookingCreateInput): Promise<BookingRow> {
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);

    const services = await this.prisma.$queryRaw<{ id: number; categoryId: number }[]>(
      Prisma.sql`SELECT id, category_id as "categoryId" FROM services WHERE id = ${input.serviceId} AND is_active = true`
    );
    const service = services[0];
    if (service === undefined) throw notFound('Service');

    const providers = await this.prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`SELECT user_id as "userId" FROM providers WHERE user_id = ${input.providerId}::uuid AND status = 'APPROVED'`);
    if (providers.length === 0) throw notFound('Provider');

    const offers = await this.prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT service_id as id FROM provider_services WHERE provider_id = ${input.providerId}::uuid AND service_id = ${input.serviceId} AND status = 'APPROVED'`
    );
    if (offers.length === 0) throw notFound('Service');

    const addresses = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM addresses WHERE id = ${input.addressId}::uuid AND customer_id = ${customerId}::uuid AND archived_at IS NULL`
    );
    if (addresses.length === 0) throw notFound('Address');

    const startWeekday = localWeekday(start);
    if (startWeekday !== localWeekday(end)) throw badRequest('A booking must start and end on the same calendar day');

    const availability = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM provider_availability WHERE provider_id = ${input.providerId}::uuid AND weekday = ${startWeekday}
        AND start_time <= ${localTimeOfDay(start)}::time AND end_time >= ${localTimeOfDay(end)}::time`
    );
    if (availability.length === 0) throw badRequest("The requested time falls outside the provider's declared availability");

    const timeOff = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM provider_time_off WHERE provider_id = ${input.providerId}::uuid AND period && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`
    );
    if (timeOff.length > 0) throw badRequest('The provider has recorded leave over part of this window');

    const priced = await this.prisma.$queryRaw<{ pricePaisa: bigint }[]>(
      Prisma.sql`SELECT price_paisa as "pricePaisa" FROM provider_services WHERE provider_id = ${input.providerId}::uuid AND service_id = ${input.serviceId}`
    );
    const pricePaisa = priced[0]?.pricePaisa;
    if (pricePaisa === undefined) throw notFound('Service');

    const commissionRateBp = await this.resolveCommissionRateBp(input.providerId, service.categoryId);

    try {
      const rows = await this.prisma.$queryRaw<BookingRowRaw[]>(
        Prisma.sql`INSERT INTO bookings(customer_id, provider_id, service_id, address_id, status, payment_mode, slot, scheduled_start, scheduled_end, problem_text, quoted_amount_paisa, approved_total_paisa, commission_rate_bp)
          VALUES (${customerId}::uuid, ${input.providerId}::uuid, ${input.serviceId}, ${input.addressId}::uuid, 'REQUESTED'::booking_status, 'CASH'::payment_mode,
            tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)'), ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz,
            ${input.problemText ?? null}, ${pricePaisa}, ${pricePaisa}, ${commissionRateBp})
          RETURNING ${BOOKING_COLUMNS}`
      );
      const row = rows[0];
      if (row === undefined) throw new Error('Booking insert did not return a row');
      await this.prisma.$executeRaw(
        Prisma.sql`INSERT INTO booking_items(booking_id, kind, description, quantity, unit_price_paisa, amount_paisa)
          VALUES (${row.id}::uuid, 'SERVICE'::item_kind, 'Service charge', 1, ${pricePaisa}, ${pricePaisa})`
      );
      await this.prisma.$executeRaw(
        Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
          VALUES (${row.id}::uuid, NULL, 'REQUESTED'::booking_status, 'create', ${customerId}::uuid, 'CUSTOMER'::actor_role, '{}'::jsonb)`
      );
      return toBookingRow(row);
    } catch (error) {
      const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown } | undefined) : undefined;
      if (meta?.code === EXCLUSION_VIOLATION) throw conflict('That provider is no longer free at this time');
      throw error;
    }
  }

  /** Provider-scoped rate wins, then category-scoped, then the platform GLOBAL default (always seeded). */
  private async resolveCommissionRateBp(providerId: string, categoryId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ rateBp: number; scope: string }[]>(
      Prisma.sql`SELECT rate_bp as "rateBp", scope FROM commission_rules
        WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
          AND ((scope = 'PROVIDER' AND provider_id = ${providerId}::uuid) OR (scope = 'CATEGORY' AND category_id = ${categoryId}) OR scope = 'GLOBAL')
        ORDER BY CASE scope WHEN 'PROVIDER' THEN 0 WHEN 'CATEGORY' THEN 1 ELSE 2 END
        LIMIT 1`
    );
    const rate = rows[0];
    if (rate === undefined) throw new Error('No commission rule resolved — expected at least a GLOBAL default to be seeded');
    return rate.rateBp;
  }
}
```

## File: apps/api/src/booking/booking.controller.ts
```typescript
// apps/api/src/booking/booking.controller.ts
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { bookingCreateSchema } from './booking.schemas.js';
import { BookingService } from './booking.service.js';

@ApiTags('booking')
@ApiBearerAuth()
@Controller('bookings')
export class BookingController {
  constructor(@Inject(BookingService) private readonly bookings: BookingService) {}

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Request a provider for a service',
    description:
      "Books a specific provider (found through search) for a service at a chosen time. The time must fall inside the provider's declared weekly availability and not collide with their recorded leave or an existing booking — the database itself refuses two overlapping bookings for the same provider, so a race between two customers requesting the same slot is resolved automatically."
  })
  @ApiZodBody(bookingCreateSchema, {
    default: {
      summary: 'Book a plumber for a leak repair',
      value: { providerId: '00000000-0000-4000-8000-000000000000', serviceId: 1, addressId: '00000000-0000-4000-8000-000000000001', scheduledStart: '2026-10-01T10:00:00.000Z', scheduledEnd: '2026-10-01T11:00:00.000Z', problemText: 'Kitchen tap is leaking' }
    }
  })
  async create(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.create(principal.userId, parseWith(bookingCreateSchema, body));
  }
}
```

## File: apps/api/src/booking/booking.module.ts
```typescript
// apps/api/src/booking/booking.module.ts
import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';

@Module({
  controllers: [BookingController],
  providers: [BookingService]
})
export class BookingModule {}
```

## File: apps/api/test/integration/booking.test.ts
```typescript
// apps/api/test/integration/booking.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify } from './harness.js';

let app: NestFastifyApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
});

const asCustomer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

const aFutureSlot = (hoursFromNow = 72): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() };
};

const bookingSetup = async (): Promise<{ providerId: string; serviceId: number; customerAccessToken: string; addressId: string; minPricePaisa: number }> => {
  const { provider, serviceId, areaId, minPricePaisa } = await readyBookableProvider(app);
  const customer = await registerAndVerify(app, 'CUSTOMER');
  const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
  return { providerId: provider.id, serviceId, customerAccessToken: customer.accessToken, addressId: address.body.id, minPricePaisa };
};

describe('FR-BK-01/02/04: create a booking', () => {
  it('lets a customer request a specific, ready provider for a service at a chosen time', async () => {
    const { providerId, serviceId, customerAccessToken, addressId, minPricePaisa } = await bookingSetup();
    const { scheduledStart, scheduledEnd } = aFutureSlot();

    const created = await callApi<{ id: string; status: string; quotedAmountPaisa: number; approvedTotalPaisa: number }>(
      app,
      '/bookings',
      asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, scheduledStart, scheduledEnd, problemText: 'Kitchen tap is leaking' }))
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('REQUESTED');
    expect(created.body.quotedAmountPaisa).toBe(minPricePaisa);
    expect(created.body.approvedTotalPaisa).toBe(minPricePaisa);
  });

  it('rejects a second overlapping request for the same provider with CONFLICT', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const slot = aFutureSlot();
    await callApi(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...slot })));

    const secondCustomer = await registerAndVerify(app, 'CUSTOMER');
    const secondAddress = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(secondCustomer.accessToken, postJson({ label: 'Home', line1: 'House 2', areaId: (await readyBookableProvider(app)).areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const overlapping = await callApi<{ code: string }>(
      app,
      '/bookings',
      asCustomer(secondCustomer.accessToken, postJson({ providerId, serviceId, addressId: secondAddress.body.id, ...slot }))
    );
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.code).toBe('CONFLICT');
  });

  it('rejects a time outside the provider’s declared availability', async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app); // note: NOT using bookingSetup's all-day calendar
    await callApi(app, '/provider/availability', { method: 'PUT', headers: { authorization: `Bearer ${provider.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ items: [] }) });
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, ...aFutureSlot() })));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('rejects a service the provider does not offer', async () => {
    const { providerId, customerAccessToken, addressId } = await bookingSetup();
    const otherService = await callApi<{ id: number }>(app, '/catalogue/services/blocked-drain');
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId: otherService.body.id, addressId, ...aFutureSlot() })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects an address that does not belong to the requesting customer', async () => {
    const { providerId, serviceId, customerAccessToken } = await bookingSetup();
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    const strangerAddress = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(stranger.accessToken, postJson({ label: 'Home', line1: 'House 9', areaId: (await readyBookableProvider(app)).areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId: strangerAddress.body.id, ...aFutureSlot() })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects booking writes from a signed in provider', async () => {
    const { providerId, serviceId, addressId } = await bookingSetup();
    const otherProvider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(otherProvider.accessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
```

## File: apps/api/src/app.module.ts
```typescript
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { IdempotencyModule } from './common/idempotency.service.js';
import { PolicyGuard } from './common/policy.guard.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { BookingModule } from './booking/booking.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { EnvironmentModule } from './config/environment.module.js';
import { PrismaModule } from './database/prisma.service.js';
import { RedisModule } from './database/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PlacesModule } from './places/places.module.js';
import { ProviderModule } from './provider/provider.module.js';
import { QueueModule } from './queues/queue.registry.js';
import { SearchModule } from './search/search.module.js';

@Module({
  imports: [EnvironmentModule, PrismaModule, RedisModule, QueueModule, IntegrationsModule, PlatformModule, IdempotencyModule, IdentityModule, CatalogueModule, PlacesModule, CustomerModule, ProviderModule, SearchModule, BookingModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: PolicyGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }
  ]
})
export class AppModule {}
```

## File: apps/api/src/http-app.ts
```typescript
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
```

## File: apps/api/test/integration/harness.ts
```typescript
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module.js';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { configureHttpApp, registerHttpPlugins } from '../../src/http-app.js';
import { totpCode } from '../../src/identity/otp.js';
import { decryptTotpSecret } from '../../src/identity/totp-vault.js';
import { SettingsService } from '../../src/platform/settings.service.js';

export type TestUser = { id: string; phoneE164: string; email: string | null; accessToken: string; refreshCookie: string | undefined };

export type ApiResponse<T = unknown> = { status: number; body: T; setCookie: string[] };

/**
 * Boots the real application graph against the running PostGIS and Redis so the
 * identity suite exercises routing, the policy guard, the idempotency
 * interceptor and the database together rather than mocking any of them.
 */
export const createTestApp = async (): Promise<{ app: NestFastifyApplication; close: () => Promise<void> }> => {
  const environment = new EnvironmentService();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false, trustProxy: true }), { logger: false });
  await registerHttpPlugins(app, environment);
  configureHttpApp(app, environment);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await app.get(SettingsService).start();
  return {
    app,
    close: async () => {
      await app.get(SettingsService).stop();
      await app.close();
    }
  };
};

export const uniquePhone = (): string => `+9231${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

export const newStaffSession = (): string => randomUUID();

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type InjectLike = { statusCode: number; body: string; cookies: { name: string; value: string; path?: string }[] };

export const callApi = async <T = unknown>(app: NestFastifyApplication, path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const server = app.getHttpAdapter().getInstance();
  const hasBody = init.body !== undefined;
  const options = {
    method: (init.method ?? 'GET') as HttpMethod,
    url: path.startsWith('/api/v1') ? path : `/api/v1${path}`,
    // Only advertise JSON when there is a body: Fastify rejects a request that
    // claims application/json and then sends nothing.
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) },
    ...(hasBody ? { payload: init.body as string } : {})
  };
  const response = (await server.inject(options)) as unknown as InjectLike;
  let body: unknown;
  try {
    body = response.body === '' ? null : JSON.parse(response.body);
  } catch {
    body = response.body;
  }
  return { status: response.statusCode, body: body as T, setCookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}; Path=${cookie.path ?? '/'}`) };
};

export const postJson = (payload: unknown, token?: string): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(payload),
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
});

export const patchJson = (payload: unknown, token?: string): RequestInit => ({
  method: 'PATCH',
  body: JSON.stringify(payload),
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
});

export const putJson = (payload: unknown, token?: string): RequestInit => ({
  method: 'PUT',
  body: JSON.stringify(payload),
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
});

export const deleteWith = (token?: string): RequestInit => ({
  method: 'DELETE',
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
});

/** Reads the most recent code the mock SMS adapter captured for a target. */
export const readOtpFromInbox = async (app: NestFastifyApplication, target: string): Promise<string> => {
  const response = await callApi<{ items: { recipient: string; body: string; metadata?: Record<string, string> }[] }>(app, '/dev/inbox?limit=50');
  const message = response.body.items.find(item => item.recipient === target);
  if (message === undefined) throw new Error(`No inbox message was delivered to ${target}`);
  const match = /\b(\d{6})\b/.exec(message.body);
  if (match === null) throw new Error(`The inbox message for ${target} carries no six digit code`);
  return match[1] as string;
};

export const refreshCookieOf = (response: ApiResponse): string | undefined => {
  const cookie = response.setCookie.find(entry => entry.startsWith('shm_rt='));
  return cookie?.split(';')[0];
};

export const registerAndVerify = async (app: NestFastifyApplication, role: 'CUSTOMER' | 'PROVIDER', phone = uniquePhone()): Promise<TestUser> => {
  const password = 'CorrectHorse9Battery';
  const registered = await callApi<{ userId: string }>(app, '/auth/register', postJson({ role, phoneE164: phone, password, firstName: 'Test', lastName: 'User' }));
  if (registered.status !== 201) throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
  const code = await readOtpFromInbox(app, phone);
  const verified = await callApi<{ user: { id: string; roles: string[] }; accessToken: string }>(app, '/auth/otp/verify', postJson({ target: phone, purpose: 'REGISTER', code }));
  if (verified.status !== 201) throw new Error(`otp verify failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  return { id: registered.body.userId, phoneE164: phone, email: null, accessToken: verified.body.accessToken, refreshCookie: refreshCookieOf(verified) };
};

export const loginAs = async (app: NestFastifyApplication, identifier: string, password: string, totpCode?: string): Promise<ApiResponse<{ accessToken: string; user: { id: string; roles: string[]; totpEnabled: boolean }; totpRequired: boolean }>> =>
  callApi(app, '/auth/login', postJson(totpCode === undefined ? { identifier, password } : { identifier, password, totpCode }));

export const SEEDED_ADMIN = { identifier: 'admin@smart-home.local', password: 'DevPassword!2026' };

/**
 * A provider fully set up and approved to offer leak-repair, with a weekly
 * availability block covering the requested window and no service-area
 * restriction that would block a test. Centred on BASE_LAT/BASE_LNG (Lahore)
 * so distance-based logic elsewhere in the suite keeps working the same way.
 */
export const readyBookableProvider = async (
  app: NestFastifyApplication
): Promise<{ provider: TestUser; serviceId: number; areaId: number; minPricePaisa: number }> => {
  const admin = await adminSession(app);
  const service = await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair');
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
  const areaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;

  const provider = await registerAndVerify(app, 'PROVIDER');
  const asProvider = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${provider.accessToken}` } });
  await callApi(app, '/provider/profile', asProvider(patchJson({ cityId: lahore.id, lat: 31.5204, lng: 74.3587, radiusM: 10_000 })));
  // Every weekday, 00:00-23:59, so any test-chosen slot lands inside it without the suite needing to know today's weekday.
  await callApi(
    app,
    '/provider/availability',
    asProvider(putJson({ items: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: '00:00', endTime: '23:59' })) }))
  );
  await callApi(app, '/provider/service-areas', asProvider(putJson({ areaIds: [areaId] })));
  await callApi(app, `/provider/services/${service.body.id}`, putJson({ pricePaisa: service.body.minPricePaisa }, provider.accessToken));
  const adminAuth = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` } });
  await callApi(app, `/admin/provider-services/${provider.id}/${service.body.id}/approve`, adminAuth({ method: 'POST' }));
  await callApi(app, `/admin/providers/${provider.id}/approve`, adminAuth({ method: 'POST' }));

  return { provider, serviceId: service.body.id, areaId, minPricePaisa: service.body.minPricePaisa };
};

let testPrisma: PrismaClient | undefined;
const prismaForTests = (): PrismaClient => (testPrisma ??= new PrismaClient());

/**
 * Signs in as the seeded admin with a valid TOTP code. The seeded admin is
 * shared, mutable state across the whole integration suite: the first run
 * against a fresh database enrols TOTP itself, and every later run (this
 * suite or an earlier one) reads the already-enrolled secret back out of the
 * database — decrypted with the same key the API uses — because there is no
 * way to recover a secret that a previous run already consumed.
 */
export const adminSession = async (app: NestFastifyApplication): Promise<{ accessToken: string; userId: string }> => {
  const bare = await loginAs(app, SEEDED_ADMIN.identifier, SEEDED_ADMIN.password);
  if (bare.status === 201 && bare.body.totpRequired && !bare.body.user.totpEnabled) {
    const setup = await callApi<{ secret: string }>(app, '/auth/totp/setup', { method: 'POST', headers: { authorization: `Bearer ${bare.body.accessToken}` } });
    const code = totpCode(setup.body.secret, new Date());
    await callApi(app, '/auth/totp/verify', postJson({ code }, bare.body.accessToken));
    const signedIn = await loginAs(app, SEEDED_ADMIN.identifier, SEEDED_ADMIN.password, code);
    if (signedIn.status !== 201) throw new Error(`admin totp login failed after enrolment: ${signedIn.status} ${JSON.stringify(signedIn.body)}`);
    return { accessToken: signedIn.body.accessToken, userId: signedIn.body.user.id };
  }
  const rows = await prismaForTests().$queryRaw<{ secret: Buffer }[]>`SELECT totp_secret_enc as secret FROM users WHERE email = ${SEEDED_ADMIN.identifier}`;
  const encrypted = rows[0]?.secret;
  if (encrypted === undefined) throw new Error('Seeded admin has no TOTP secret to decrypt');
  const secret = decryptTotpSecret(Buffer.from(process.env.TOTP_ENCRYPTION_KEY ?? '', 'base64'), encrypted);
  const code = totpCode(secret, new Date());
  const signedIn = await loginAs(app, SEEDED_ADMIN.identifier, SEEDED_ADMIN.password, code);
  if (signedIn.status !== 201) throw new Error(`admin totp login failed: ${signedIn.status} ${JSON.stringify(signedIn.body)}`);
  return { accessToken: signedIn.body.accessToken, userId: signedIn.body.user.id };
};
```

