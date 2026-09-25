# Review package — Task 3 (no-git adaptation: full contents of touched files, not a diff)

## Files touched (all modified, no new files)
- apps/api/src/booking/booking.schemas.ts
- apps/api/src/booking/booking.service.ts
- apps/api/src/booking/booking.controller.ts
- apps/api/test/integration/booking.test.ts

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

export const bookingListQuerySchema = z
  .object({
    status: z.enum(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW']).optional()
  })
  .strict();

export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
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
      return await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<BookingRowRaw[]>(
          Prisma.sql`INSERT INTO bookings(customer_id, provider_id, service_id, address_id, status, payment_mode, slot, scheduled_start, scheduled_end, problem_text, quoted_amount_paisa, approved_total_paisa, commission_rate_bp)
            VALUES (${customerId}::uuid, ${input.providerId}::uuid, ${input.serviceId}, ${input.addressId}::uuid, 'REQUESTED'::booking_status, 'CASH'::payment_mode,
              tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)'), ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz,
              ${input.problemText ?? null}, ${pricePaisa}, ${pricePaisa}, ${commissionRateBp})
            RETURNING ${BOOKING_COLUMNS}`
        );
        const row = rows[0];
        if (row === undefined) throw new Error('Booking insert did not return a row');
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_items(booking_id, kind, description, quantity, unit_price_paisa, amount_paisa)
            VALUES (${row.id}::uuid, 'SERVICE'::item_kind, 'Service charge', 1, ${pricePaisa}, ${pricePaisa})`
        );
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
            VALUES (${row.id}::uuid, NULL, 'REQUESTED'::booking_status, 'create', ${customerId}::uuid, 'CUSTOMER'::actor_role, '{}'::jsonb)`
        );
        return toBookingRow(row);
      });
    } catch (error) {
      const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown } | undefined) : undefined;
      if (meta?.code === EXCLUSION_VIOLATION) throw conflict('That provider is no longer free at this time');
      throw error;
    }
  }

  async getOwned(bookingId: string, actorUserId: string): Promise<BookingRow> {
    const rows = await this.prisma.$queryRaw<BookingRowRaw[]>(
      Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid AND (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');
    return toBookingRow(row);
  }

  async listMine(actorUserId: string, status?: string): Promise<BookingRow[]> {
    const rows = await this.prisma.$queryRaw<BookingRowRaw[]>(
      Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings
        WHERE (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)
          AND (${status ?? null}::booking_status IS NULL OR status = ${status ?? null}::booking_status)
        ORDER BY created_at DESC`
    );
    return rows.map(toBookingRow);
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
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { bookingCreateSchema, bookingListQuerySchema } from './booking.schemas.js';
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

  @Get(':id')
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'Read one booking', description: 'Returns full booking detail. Visible only to the booking\'s own customer or its assigned provider — anyone else gets a 404, same as everywhere else in this API that hides existence from non-owners.' })
  async getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.getOwned(id, principal.userId);
  }

  @Get()
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'List my bookings', description: 'Returns every booking you are the customer or the provider on, most recent first. Optionally filter by status.' })
  @ApiQueryField('status', { enum: ['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW'] })
  async listMine(@Query() query: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { status } = parseWith(bookingListQuerySchema, query);
    return { items: await this.bookings.listMine(principal.userId, status) };
  }
}
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

describe('reading bookings', () => {
  it('lets the customer and the provider both read a booking they are part of', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));

    const asCustomerRead = await callApi<{ id: string; status: string }>(app, `/bookings/${created.body.id}`, asCustomer(customerAccessToken));
    expect(asCustomerRead.status).toBe(200);
    expect(asCustomerRead.body.status).toBe('REQUESTED');
  });

  it('hides a booking from someone who is neither its customer nor its provider', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}`, asCustomer(stranger.accessToken));
    expect(response.status).toBe(404);
  });

  it("lists a customer's own bookings", async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const listed = await callApi<{ items: { id: string }[] }>(app, '/bookings', asCustomer(customerAccessToken));
    expect(listed.body.items.map(item => item.id)).toContain(created.body.id);
  });
});
```

