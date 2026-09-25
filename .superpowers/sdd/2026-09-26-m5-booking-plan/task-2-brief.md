## Task 2: Booking creation (`POST /bookings`)

This is the foundational task: it creates `apps/api/src/booking/` and every file in it, wires the module into `app.module.ts`, and adds the `readyBookableProvider()` test helper other tasks reuse.

**Files:**
- Create: `apps/api/src/booking/booking.schemas.ts`
- Create: `apps/api/src/booking/booking.service.ts`
- Create: `apps/api/src/booking/booking.controller.ts`
- Create: `apps/api/src/booking/booking.module.ts`
- Modify: `apps/api/src/app.module.ts` — import and register `BookingModule`
- Modify: `apps/api/src/http-app.ts` — add the `booking` Swagger tag
- Modify: `apps/api/test/integration/harness.ts` — add `readyBookableProvider()`
- Create: `apps/api/test/integration/booking.test.ts`

**Interfaces:**
- Consumes: `wallTimeIn` from `@smart-home/domain` (already exported via `slaCalendar.ts`); `registerAndVerify`, `adminSession`, `callApi`, `postJson`, `patchJson`, `putJson` from `harness.ts` (all exist already).
- Produces: `BookingRow` type (id, code, customerId, providerId, serviceId, addressId, status, paymentMode, scheduledStart, scheduledEnd, problemText, quotedAmountPaisa, approvedTotalPaisa, finalAmountPaisa, rescheduleCount, noShowParty, cancelReason, startOtpVerifiedAt, createdAt, updatedAt) and `BOOKING_COLUMNS` (a `Prisma.sql` fragment), both in `booking.service.ts`, reused by every later task. `bookingCreateSchema` in `booking.schemas.ts`. `readyBookableProvider(app, overrides?)` in `harness.ts`, returning `{ provider: TestUser; serviceId: number; areaId: number }`.

- [ ] **Step 1: Add the `readyBookableProvider` test helper**

This mirrors the `readyProvider()` helper already written inline in `search.test.ts` — pulled into the shared harness because every booking test needs it, not just search's.

Add to `apps/api/test/integration/harness.ts`:
```typescript
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
```

This references `NestFastifyApplication`, `TestUser`, `adminSession`, `callApi`, `patchJson`, `putJson`, `registerAndVerify` — all already imported/defined in `harness.ts`; no new imports needed for this step.

- [ ] **Step 2: Write the failing test**

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
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
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

- [ ] **Step 3: Run test to verify it fails**

Run (from `apps/api/`): `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: FAIL — every case 404s (no `/bookings` route exists yet)

- [ ] **Step 4: Write `booking.schemas.ts`**

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

- [ ] **Step 5: Write `booking.service.ts`**

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

- [ ] **Step 6: Write `booking.controller.ts`**

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

- [ ] **Step 7: Write `booking.module.ts` and wire it into `app.module.ts`**

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

In `apps/api/src/app.module.ts`, add the import and register it in the `imports` array (alongside `SearchModule`, following the exact pattern already there for every other feature module):
```typescript
import { BookingModule } from './booking/booking.module.js';
```
```typescript
imports: [EnvironmentModule, PrismaModule, RedisModule, QueueModule, IntegrationsModule, PlatformModule, IdempotencyModule, IdentityModule, CatalogueModule, PlacesModule, CustomerModule, ProviderModule, SearchModule, BookingModule],
```

In `apps/api/src/http-app.ts`, add one more `.addTag(...)` call alongside the existing ones:
```typescript
.addTag('booking', 'Request a provider for a service and carry the job through to completion: accept/decline, cancel/reschedule, arrival OTP, checklist, quote revisions, and finishing the job.')
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit` (expect clean), then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/booking apps/api/src/app.module.ts apps/api/src/http-app.ts apps/api/test/integration/harness.ts apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add booking creation with availability/overlap validation"
```

---

