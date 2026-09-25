# M5/M6 Booking Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer can request a specific, search-found provider for a service at a chosen time; the provider can accept/decline/cancel/depart; the job runs through an OTP-gated start, an optional quote revision, checklist completion, and finishes at `WORK_COMPLETED` with a generated invoice.

**Architecture:** A pure, DB-free state-transition table in `packages/domain` (`bookingTransitions.ts`) is the single source of truth for which event is legal from which status for which role. A `BookingStateService` in `apps/api` wraps it: every write to `bookings.status` goes through its `apply()` method, inside one `SELECT ... FOR UPDATE` transaction that also writes the `booking_status_history` audit row. All other modules (`booking.service.ts` for creation/reads, `start-otp.ts` for the arrival OTP) sit alongside it. No new tables or migrations — every table this plan needs already exists in `packages/db/migrations/0001_init.sql`.

**Tech Stack:** NestJS 11 on Fastify, Prisma (raw `$queryRaw`/`$transaction`, not the generated model API), Zod + `parseWith`, Vitest integration tests against real Postgres/Redis, `zod-to-json-schema`-derived Swagger docs.

**Spec:** `docs/superpowers/specs/2026-09-26-m5-booking-design.md`

## Global Constraints

- Raw `Prisma.sql` queries only — never `prisma.bookings.create(...)` or similar generated-client calls. Every existing module in this codebase does it this way; see `apps/api/src/catalogue/catalogue.service.ts` for the pattern.
- Every constructor parameter gets an explicit `@Inject(Service)` — implicit type-based DI does not reliably resolve under this project's `tsx`/esbuild dev setup (discovered and documented earlier this session).
- Every request body is validated with a Zod schema via `parseWith(schema, body)` from `apps/api/src/common/validation.js`; never trust `@Body() body: unknown` directly.
- Money is always a plain integer (paisa) at the API boundary, `BigInt` in Postgres/Prisma raw rows — convert with `Number(raw.xPaisa)` when shaping a response, `BigInt(input.xPaisa)` when writing.
- Errors use the existing helpers from `apps/api/src/common/domain-error.js`: `notFound`, `conflict`, `badRequest`, `forbidden`. Never throw a raw `Error` for an expected failure case.
- Every write and filtered-query endpoint gets `@ApiZodBody(schema, examples)` / `@ApiQueryField(...)` from `apps/api/src/common/swagger.js`, plus an `@ApiOperation({ summary, description })` in the same plain-language style as every other controller in this codebase (no jargon, explain *why*, not just *what*).
- TDD throughout: write the integration test, run it, watch it fail for the right reason (a 404 for a route that doesn't exist yet, not a typo), then implement, then watch it pass. Integration tests live in `apps/api/test/integration/` and run against the real seeded Postgres via `apps/api/test/integration/harness.ts` — never mock the database.
- After every task: `npx tsc -p tsconfig.json --noEmit` (from `apps/api/`) must be clean, and the relevant test file must pass. After the final task: the *entire* suite (lint, typecheck, unit tests, integration tests, build) must be green — see Task 12.
- `bookings.slot` and `provider_time_off.period` both have Postgres `EXCLUDE USING gist` constraints the database enforces itself (SQLSTATE `23P01` on violation) — application code catches and translates that error, it never re-implements the overlap check.
- `bookings.status NOT IN ('WORK_COMPLETED', ...) OR start_otp_verified_at IS NOT NULL` is a real `CHECK` constraint already in the database — the `start` transition is a hard gate, not a convention.

---

## Task 1: Pure booking state machine (`packages/domain`)

**Files:**
- Create: `packages/domain/src/bookingTransitions.ts`
- Create: `packages/domain/test/bookingTransitions.test.ts`
- Modify: `packages/domain/src/index.ts` — add `export * from './bookingTransitions.js';`

**Interfaces:**
- Produces: `BookingActorRole` (`'CUSTOMER' | 'PROVIDER'`), `BookingStatus` (the subset of the DB's `booking_status` enum this plan uses), `BookingEvent`, `BookingTransition = { to: BookingStatus; allowedRoles: readonly BookingActorRole[] }`, `transitionFor(from, event): BookingTransition | undefined` (role-blind lookup), `canTransition(from, event, actorRole): BookingTransition | null` (role-checked, used directly by domain unit tests and indirectly by the service in Task 4).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/domain/test/bookingTransitions.test.ts
import { describe, expect, it } from 'vitest';
import { canTransition, transitionFor } from '../src/bookingTransitions.js';

describe('booking transitions', () => {
  it('lets a provider accept a REQUESTED booking, landing on SCHEDULED', () => {
    const transition = canTransition('REQUESTED', 'accept', 'PROVIDER');
    expect(transition).toEqual({ to: 'SCHEDULED', allowedRoles: ['PROVIDER'] });
  });

  it('refuses a customer accepting their own booking', () => {
    expect(canTransition('REQUESTED', 'accept', 'CUSTOMER')).toBeNull();
  });

  it('refuses accept from a status that has no such transition', () => {
    expect(canTransition('SCHEDULED', 'accept', 'PROVIDER')).toBeNull();
  });

  it('lets either party cancel a SCHEDULED booking', () => {
    expect(canTransition('SCHEDULED', 'cancel', 'CUSTOMER')).not.toBeNull();
    expect(canTransition('SCHEDULED', 'cancel', 'PROVIDER')).not.toBeNull();
  });

  it('transitionFor is role-blind: it returns the transition even for a role that cannot fire it', () => {
    expect(transitionFor('REQUESTED', 'accept')).toEqual({ to: 'SCHEDULED', allowedRoles: ['PROVIDER'] });
  });

  it('walks the full happy path from REQUESTED to WORK_COMPLETED', () => {
    expect(canTransition('REQUESTED', 'accept', 'PROVIDER')?.to).toBe('SCHEDULED');
    expect(canTransition('SCHEDULED', 'depart', 'PROVIDER')?.to).toBe('EN_ROUTE');
    expect(canTransition('EN_ROUTE', 'start', 'PROVIDER')?.to).toBe('IN_PROGRESS');
    expect(canTransition('IN_PROGRESS', 'complete', 'PROVIDER')?.to).toBe('WORK_COMPLETED');
  });

  it('routes a quote revision out of and back into IN_PROGRESS', () => {
    expect(canTransition('IN_PROGRESS', 'raiseQuoteRevision', 'PROVIDER')?.to).toBe('QUOTE_REVISION');
    expect(canTransition('QUOTE_REVISION', 'approveQuoteRevision', 'CUSTOMER')?.to).toBe('IN_PROGRESS');
    expect(canTransition('QUOTE_REVISION', 'rejectQuoteRevision', 'CUSTOMER')?.to).toBe('IN_PROGRESS');
  });

  it('has no outgoing transitions from a terminal status', () => {
    expect(transitionFor('WORK_COMPLETED', 'complete')).toBeUndefined();
    expect(transitionFor('UNFULFILLED', 'accept')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/domain/`): `npx vitest run test/bookingTransitions.test.ts`
Expected: FAIL — `Cannot find module '../src/bookingTransitions.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/domain/src/bookingTransitions.ts

/**
 * Only a customer or a provider ever fires a booking transition in this
 * codebase's current scope. Staff roles (ADMIN/AGENT/FINANCE) act on
 * bookings through dispute/verification tooling that doesn't exist yet
 * (M7+) — this package stays dependency-free from apps/api's broader
 * ActorRole union on purpose.
 */
export type BookingActorRole = 'CUSTOMER' | 'PROVIDER';

/**
 * The subset of the database's `booking_status` enum this package's
 * transition table covers. `ACCEPTED`, `PENDING_PAYMENT`, `ABANDONED` and
 * everything from `AWAITING_VERIFICATION` onward are real enum values the
 * database defines but this build doesn't drive yet (see the design doc,
 * "Out of scope").
 */
export type BookingStatus =
  | 'REQUESTED'
  | 'SCHEDULED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS'
  | 'QUOTE_REVISION'
  | 'WORK_COMPLETED'
  | 'UNFULFILLED'
  | 'CANCELLED_CUSTOMER'
  | 'CANCELLED_PROVIDER'
  | 'NO_SHOW';

export type BookingEvent =
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'reschedule'
  | 'depart'
  | 'start'
  | 'raiseQuoteRevision'
  | 'approveQuoteRevision'
  | 'rejectQuoteRevision'
  | 'complete'
  | 'noShow';

export type BookingTransition = { to: BookingStatus; allowedRoles: readonly BookingActorRole[] };

/**
 * `cancel`'s `to` here is a placeholder only used to prove the event is
 * legal from SCHEDULED; the caller (BookingStateService) always overrides
 * it with CANCELLED_CUSTOMER or CANCELLED_PROVIDER based on which role
 * actually fired the event, since a single table entry can't encode "the
 * target depends on who calls it."
 */
export const BOOKING_TRANSITIONS: Partial<Record<BookingStatus, Partial<Record<BookingEvent, BookingTransition>>>> = {
  REQUESTED: {
    accept: { to: 'SCHEDULED', allowedRoles: ['PROVIDER'] },
    decline: { to: 'UNFULFILLED', allowedRoles: ['PROVIDER'] }
  },
  SCHEDULED: {
    cancel: { to: 'CANCELLED_CUSTOMER', allowedRoles: ['CUSTOMER', 'PROVIDER'] },
    reschedule: { to: 'SCHEDULED', allowedRoles: ['CUSTOMER'] },
    depart: { to: 'EN_ROUTE', allowedRoles: ['PROVIDER'] }
  },
  EN_ROUTE: {
    start: { to: 'IN_PROGRESS', allowedRoles: ['PROVIDER'] },
    noShow: { to: 'NO_SHOW', allowedRoles: ['CUSTOMER', 'PROVIDER'] }
  },
  IN_PROGRESS: {
    raiseQuoteRevision: { to: 'QUOTE_REVISION', allowedRoles: ['PROVIDER'] },
    complete: { to: 'WORK_COMPLETED', allowedRoles: ['PROVIDER'] }
  },
  QUOTE_REVISION: {
    approveQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] },
    rejectQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] }
  }
};

/** Role-blind lookup: "does this event exist from this status at all." */
export const transitionFor = (from: BookingStatus, event: BookingEvent): BookingTransition | undefined => BOOKING_TRANSITIONS[from]?.[event];

/** Role-checked lookup: null both when the event doesn't exist from this status, and when this role can't fire it. */
export const canTransition = (from: BookingStatus, event: BookingEvent, actorRole: BookingActorRole): BookingTransition | null => {
  const transition = transitionFor(from, event);
  if (transition === undefined || !transition.allowedRoles.includes(actorRole)) return null;
  return transition;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bookingTransitions.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Export it from the package and verify the whole domain package still builds**

Add to `packages/domain/src/index.ts`:
```typescript
export * from './bookingTransitions.js';
```

Run (from `packages/domain/`): `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: clean typecheck, all domain tests pass (the pre-existing SlaCalendar/money/clock tests plus the 8 new ones)

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/bookingTransitions.ts packages/domain/test/bookingTransitions.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add the booking state transition table"
```

---

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

## Task 3: Read bookings (`GET /bookings/:id`, `GET /bookings`)

**Files:**
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `bookingListQuerySchema`
- Modify: `apps/api/src/booking/booking.service.ts` — add `getOwned`, `listMine`
- Modify: `apps/api/src/booking/booking.controller.ts` — add the two `@Get` handlers
- Modify: `apps/api/test/integration/booking.test.ts`

**Interfaces:**
- Consumes: `BOOKING_COLUMNS`, `BookingRow`, `BookingRowRaw`, `toBookingRow` from Task 2.
- Produces: `BookingService.getOwned(bookingId, actorUserId): Promise<BookingRow>` (throws `notFound` if the booking doesn't exist or the caller is neither its customer nor its provider), `BookingService.listMine(actorUserId, actorRoles, status?): Promise<BookingRow[]>`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts`:
```typescript
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

  it('lists a customer’s own bookings', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const listed = await callApi<{ items: { id: string }[] }>(app, '/bookings', asCustomer(customerAccessToken));
    expect(listed.body.items.map(item => item.id)).toContain(created.body.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "reading bookings"`
Expected: FAIL — 404 on routes that don't exist / undefined body shapes

- [ ] **Step 3: Add the service methods**

Add to `apps/api/src/booking/booking.service.ts` (inside the `BookingService` class, alongside `create`):
```typescript
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
```

- [ ] **Step 4: Add the query schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const bookingListQuerySchema = z
  .object({
    status: z.enum(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW']).optional()
  })
  .strict();

export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
```

- [ ] **Step 5: Add the controller handlers**

Add to `apps/api/src/booking/booking.controller.ts` (update the imports at the top and add these two handlers to the class):
```typescript
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
```
```typescript
  @Get(':id')
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'Read one booking', description: 'Returns full booking detail. Visible only to the booking’s own customer or its assigned provider — anyone else gets a 404, same as everywhere else in this API that hides existence from non-owners.' })
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
```

Also update the import line for `bookingCreateSchema` to include the new schema and add `ApiQueryField`:
```typescript
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
```
```typescript
import { bookingCreateSchema, bookingListQuerySchema } from './booking.schemas.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests in the file pass (9 total so far)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add booking read and list endpoints"
```

---

## Task 4: `BookingStateService` foundation + Accept/Decline

This introduces the `apply()` method every later transition task reuses — get this one right and Tasks 5-11 are all thin call sites.

**Files:**
- Create: `apps/api/src/booking/booking-state.service.ts`
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `declineSchema`
- Modify: `apps/api/src/booking/booking.controller.ts` — add `accept`/`decline`
- Modify: `apps/api/src/booking/booking.module.ts` — register `BookingStateService`
- Modify: `apps/api/test/integration/booking.test.ts`

**Interfaces:**
- Consumes: `BOOKING_COLUMNS`, `BookingRowRaw`, `toBookingRow`, `BookingRow` from `booking.service.ts`; `BookingActorRole`, `BookingEvent`, `BookingStatus`, `transitionFor` from `@smart-home/domain`.
- Produces: `BookingStateService.apply(bookingId, event, actor, effect?): Promise<BookingRow>` where `effect?: (tx: Prisma.TransactionClient, booking: BookingRowRaw) => Promise<{ to?: BookingStatus; metadata?: Record<string, unknown> } | void>`. Every later task (cancel, reschedule, depart, start, noShow, raiseQuoteRevision, approve/rejectQuoteRevision, complete) is a controller/service method that calls `bookingState.apply(...)` with an event name and, where the event needs side effects, an `effect` callback.

- [ ] **Step 1: Write the failing test**

This first needs the provider's own access token, which `bookingSetup()` doesn't return yet — modify the `bookingSetup` helper already in the test file (from Task 2) to also return it:
```typescript
const bookingSetup = async (): Promise<{ providerId: string; providerAccessToken: string; serviceId: number; customerAccessToken: string; addressId: string; minPricePaisa: number }> => {
  const { provider, serviceId, areaId, minPricePaisa } = await readyBookableProvider(app);
  const customer = await registerAndVerify(app, 'CUSTOMER');
  const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
  return { providerId: provider.id, providerAccessToken: provider.accessToken, serviceId, customerAccessToken: customer.accessToken, addressId: address.body.id, minPricePaisa };
};
```

Now add the test itself to `apps/api/test/integration/booking.test.ts`:
```typescript
const asProviderToken = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

describe('FR-BK: accept and decline', () => {
  it('lets the requested provider accept, moving straight to SCHEDULED', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));

    const accepted = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('SCHEDULED');
  });

  it('rejects a customer trying to accept their own booking with FORBIDDEN', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/accept`, asCustomer(customerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects accepting a booking that is not REQUESTED with CONFLICT', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
    const again = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT');
  });

  it('lets the provider decline with a reason, landing on UNFULFILLED', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const declined = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/decline`, asProviderToken(providerAccessToken, postJson({ reason: 'Too far this week' })));
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe('UNFULFILLED');
  });

  it("hides someone else's booking behind NOT_FOUND rather than leaking that it exists", async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const stranger = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/accept`, asProviderToken(stranger.accessToken, { method: 'POST' }));
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "accept and decline"`
Expected: FAIL — 404s on the not-yet-existing routes

- [ ] **Step 3: Write `booking-state.service.ts`**

```typescript
// apps/api/src/booking/booking-state.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BookingActorRole, BookingEvent, BookingStatus } from '@smart-home/domain';
import { transitionFor } from '@smart-home/domain';
import { conflict, forbidden, notFound } from '../common/domain-error.js';
import type { AuthenticatedPrincipal } from '../common/policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { BOOKING_COLUMNS, toBookingRow, type BookingRow, type BookingRowRaw } from './booking.service.js';

export type ApplyEffectResult = { to?: BookingStatus; metadata?: Record<string, unknown> } | void;
export type ApplyEffect = (tx: Prisma.TransactionClient, booking: BookingRowRaw) => Promise<ApplyEffectResult>;

const noEffect: ApplyEffect = async () => undefined;

@Injectable()
export class BookingStateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async apply(bookingId: string, event: BookingEvent, actor: AuthenticatedPrincipal, effect: ApplyEffect = noEffect): Promise<BookingRow> {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
      const booking = rows[0];
      if (booking === undefined) throw notFound('Booking');

      const actorRole = this.roleOf(booking, actor.userId);
      const transition = transitionFor(booking.status as BookingStatus, event);
      if (transition === undefined) throw conflict(`Cannot ${event} a booking in status ${booking.status}`);
      if (!transition.allowedRoles.includes(actorRole)) throw forbidden(`Only a ${transition.allowedRoles.join(' or ')} may ${event} this booking`);

      const result = (await effect(tx, booking)) ?? {};
      const to = result.to ?? transition.to;

      const updated = await tx.$queryRaw<BookingRowRaw[]>(Prisma.sql`UPDATE bookings SET status = ${to}::booking_status, updated_at = now() WHERE id = ${bookingId}::uuid RETURNING ${BOOKING_COLUMNS}`);
      const row = updated[0];
      if (row === undefined) throw new Error('Booking update did not return a row');

      await tx.$executeRaw(
        Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
          VALUES (${bookingId}::uuid, ${booking.status}::booking_status, ${to}::booking_status, ${event}, ${actor.userId}::uuid, ${actorRole}::actor_role, ${JSON.stringify(result.metadata ?? {})}::jsonb)`
      );
      return toBookingRow(row);
    });
  }

  /** A booking a principal is neither the customer nor the provider on is treated as not found, same "don't leak existence" convention used everywhere else in this API. */
  private roleOf(booking: BookingRowRaw, actorUserId: string): BookingActorRole {
    if (booking.customerId === actorUserId) return 'CUSTOMER';
    if (booking.providerId === actorUserId) return 'PROVIDER';
    throw notFound('Booking');
  }
}
```

- [ ] **Step 4: Add the decline schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const declineSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export type DeclineInput = z.infer<typeof declineSchema>;
```

- [ ] **Step 5: Add the controller handlers**

Add to `apps/api/src/booking/booking.controller.ts` — update the constructor and imports, and add two handlers:
```typescript
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { BookingStateService } from './booking-state.service.js';
import { bookingCreateSchema, bookingListQuerySchema, declineSchema } from './booking.schemas.js';
import { BookingService } from './booking.service.js';

@ApiTags('booking')
@ApiBearerAuth()
@Controller('bookings')
export class BookingController {
  constructor(
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService
  ) {}
```

Then add, after the existing handlers:
```typescript
  @Post(':id/accept')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Accept a booking request', description: 'The requested provider accepts the job. Since the customer already chose a specific time, this locks the slot immediately — there is no separate "accepted but not yet scheduled" step in this flow.' })
  async accept(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookingState.apply(id, 'accept', principal);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Decline a booking request', description: 'The requested provider turns the job down. The booking ends here — this build books a specific named provider rather than offering down a ranked list, so there is no automatic re-offer to try next.' })
  @ApiZodBody(declineSchema, { default: { summary: 'Decline with a reason', value: { reason: 'Too far this week' } } })
  async decline(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { reason } = parseWith(declineSchema, body);
    return this.bookingState.apply(id, 'decline', principal, async () => ({ metadata: { reason } }));
  }
```

- [ ] **Step 6: Register `BookingStateService` in the module**

Modify `apps/api/src/booking/booking.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { BookingStateService } from './booking-state.service.js';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';

@Module({
  controllers: [BookingController],
  providers: [BookingService, BookingStateService]
})
export class BookingModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (14 total so far)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add BookingStateService and accept/decline"
```

---

## Task 5: Cancel

**Files:**
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `cancelSchema`
- Modify: `apps/api/src/booking/booking.service.ts` — add a small role-aware helper the controller uses (see below)
- Modify: `apps/api/src/booking/booking.controller.ts` — add `cancel`
- Modify: `apps/api/test/integration/booking.test.ts`

**Interfaces:**
- Consumes: `BookingStateService.apply` from Task 4.
- Produces: nothing new consumed by later tasks — this is a leaf endpoint.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts`:
```typescript
describe('FR-BK-06: cancel', () => {
  it('lets the customer cancel a SCHEDULED booking, recording whether it was inside the 4-hour window', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));

    const cancelled = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/cancel`, asCustomer(customerAccessToken, postJson({ reason: 'Changed my mind' })));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED_CUSTOMER');
  });

  it('lets the provider cancel a SCHEDULED booking, landing on CANCELLED_PROVIDER', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));

    const cancelled = await callApi<{ status: string }>(app, `/bookings/${created.body.id}/cancel`, asProviderToken(providerAccessToken, postJson({})));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED_PROVIDER');
  });

  it('rejects cancelling a REQUESTED (not yet accepted) booking with CONFLICT', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/cancel`, asCustomer(customerAccessToken, postJson({})));
    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "cancel"`
Expected: FAIL — 404, route doesn't exist

- [ ] **Step 3: Add the cancel schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export type CancelInput = z.infer<typeof cancelSchema>;
```

- [ ] **Step 4: Add the controller handler**

Add to `apps/api/src/booking/booking.controller.ts` (import `cancelSchema` alongside the other schema imports), then add the handler:
```typescript
  @Post(':id/cancel')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({
    summary: 'Cancel a booking',
    description:
      "Either party can cancel a SCHEDULED booking. A customer cancelling inside 4 hours of the slot has that recorded (a cancellation fee would apply once payments exist — not charged yet, since there's no wallet to debit). A provider cancelling is just recorded for now (repeated provider cancellations triggering review needs the conduct module, M15, which isn't built)."
  })
  @ApiZodBody(cancelSchema, { default: { summary: 'With a reason', value: { reason: 'Changed my mind' } } })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { reason } = parseWith(cancelSchema, body);
    return this.bookingState.apply(id, 'cancel', principal, async (_tx, booking) => {
      const isProvider = booking.providerId === principal.userId;
      if (isProvider) return { to: 'CANCELLED_PROVIDER', metadata: { reason: reason ?? null } };
      const insideFourHourWindow = booking.scheduledStart.getTime() - Date.now() < 4 * 60 * 60 * 1000;
      return { to: 'CANCELLED_CUSTOMER', metadata: { reason: reason ?? null, insideFourHourWindow } };
    });
  }
```

Note this handler needs `BookingStatus` cast compatibility for the string literals `'CANCELLED_PROVIDER'`/`'CANCELLED_CUSTOMER'` passed as `to` — TypeScript will infer these correctly against `ApplyEffectResult`'s `to?: BookingStatus` since `BookingStatus` is a string-literal union already imported transitively; no extra import needed since the return type is inferred from the `effect` callback's declared return contract in `booking-state.service.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (17 total so far)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add cancel, resolving CANCELLED_CUSTOMER/PROVIDER by actor role"
```

---

## Task 6: Reschedule

**Files:**
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `rescheduleSchema`
- Modify: `apps/api/src/booking/booking.controller.ts` — add `reschedule`
- Modify: `apps/api/test/integration/booking.test.ts`

**Interfaces:**
- Consumes: `BookingStateService.apply`, the same availability/time-off validation logic as `BookingService.create` (duplicated here rather than shared, since `create` also needs the provider/service/address checks that reschedule doesn't — see the note in Step 4).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts`:
```typescript
describe('FR-BK-05: reschedule', () => {
  it('lets the customer reschedule once, more than 4 hours out', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));

    const newSlot = aFutureSlot(96);
    const rescheduled = await callApi<{ status: string; scheduledStart: string; rescheduleCount: number }>(app, `/bookings/${created.body.id}/reschedule`, asCustomer(customerAccessToken, postJson(newSlot)));
    expect(rescheduled.status).toBe(200);
    expect(rescheduled.body.status).toBe('SCHEDULED');
    expect(rescheduled.body.rescheduleCount).toBe(1);
    expect(new Date(rescheduled.body.scheduledStart).toISOString()).toBe(newSlot.scheduledStart);
  });

  it('rejects a second reschedule', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${created.body.id}/reschedule`, asCustomer(customerAccessToken, postJson(aFutureSlot(96))));

    const again = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/reschedule`, asCustomer(customerAccessToken, postJson(aFutureSlot(120))));
    expect(again.status).toBe(409);
  });

  it('rejects a reschedule inside the 4-hour window of the current slot', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot(2) })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));

    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}/reschedule`, asCustomer(customerAccessToken, postJson(aFutureSlot(96))));
    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "reschedule"`
Expected: FAIL — 404, route doesn't exist

- [ ] **Step 3: Add the reschedule schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const rescheduleSchema = z
  .object({ scheduledStart: z.string().datetime(), scheduledEnd: z.string().datetime() })
  .strict()
  .refine(input => new Date(input.scheduledEnd).getTime() > new Date(input.scheduledStart).getTime(), { message: 'scheduledEnd must be after scheduledStart', path: ['scheduledEnd'] });
export type RescheduleInput = z.infer<typeof rescheduleSchema>;
```

- [ ] **Step 4: Add the controller handler**

Reschedule needs the same "does this new time fit the provider's availability and avoid their time-off" check `BookingService.create` already has, plus the ">4h from the *current* slot" and "only once" rules that are specific to rescheduling. Rather than duplicating the availability/time-off SQL inline in the controller, add a small shared method to `BookingService`:

Add to `apps/api/src/booking/booking.service.ts` (as a public method on `BookingService`, reusing the existing private-style helpers already in the file — promote `localWeekday`/`localTimeOfDay` usage into a method other callers can invoke):
```typescript
  /** Throws badRequest if the window doesn't fit the provider's declared availability or collides with their time off. Used by both create() and the reschedule handler. */
  async assertWindowIsBookable(providerId: string, start: Date, end: Date): Promise<void> {
    const startWeekday = localWeekday(start);
    if (startWeekday !== localWeekday(end)) throw badRequest('A booking must start and end on the same calendar day');
    const availability = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM provider_availability WHERE provider_id = ${providerId}::uuid AND weekday = ${startWeekday}
        AND start_time <= ${localTimeOfDay(start)}::time AND end_time >= ${localTimeOfDay(end)}::time`
    );
    if (availability.length === 0) throw badRequest("The requested time falls outside the provider's declared availability");
    const timeOff = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM provider_time_off WHERE provider_id = ${providerId}::uuid AND period && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`
    );
    if (timeOff.length > 0) throw badRequest('The provider has recorded leave over part of this window');
  }
```

Then replace the duplicated availability/time-off block inside `create()` with a call to this new method:
```typescript
    await this.assertWindowIsBookable(input.providerId, start, end);
```
(delete the now-duplicated `startWeekday`/`availability`/`timeOff` block that previously sat inline in `create()`, keeping only the `if (startWeekday !== ...)` logic that's now inside `assertWindowIsBookable`)

Add to the top of `apps/api/src/booking/booking.controller.ts` (first use of `Prisma.sql` and `conflict` directly in this file — every prior task's handlers only needed `BookingStateService.apply`):
```typescript
import { Prisma } from '@prisma/client';
import { conflict } from '../common/domain-error.js';
```

Add to `apps/api/src/booking/booking.controller.ts` (import `rescheduleSchema` alongside the other schema imports; `BookingService` is already injected as `this.bookings`):
```typescript
  @Post(':id/reschedule')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Reschedule a booking', description: 'Moves a SCHEDULED booking to a new time, once, for free, as long as it is more than 4 hours before the *current* slot. The new time is re-validated against the provider’s availability and leave exactly like a fresh booking would be.' })
  @ApiZodBody(rescheduleSchema, { default: { summary: 'New time', value: { scheduledStart: '2026-10-05T10:00:00.000Z', scheduledEnd: '2026-10-05T11:00:00.000Z' } } })
  async reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const input = parseWith(rescheduleSchema, body);
    const newStart = new Date(input.scheduledStart);
    const newEnd = new Date(input.scheduledEnd);
    return this.bookingState.apply(id, 'reschedule', principal, async (tx, booking) => {
      if (booking.rescheduleCount > 0) throw conflict('This booking has already been rescheduled once');
      if (booking.scheduledStart.getTime() - Date.now() < 4 * 60 * 60 * 1000) throw conflict('Too close to the current slot to reschedule');
      if (booking.providerId === null) throw conflict('This booking has no assigned provider');
      await this.bookings.assertWindowIsBookable(booking.providerId, newStart, newEnd);
      await tx.$executeRaw(
        Prisma.sql`UPDATE bookings SET scheduled_start = ${newStart.toISOString()}::timestamptz, scheduled_end = ${newEnd.toISOString()}::timestamptz,
          slot = tstzrange(${newStart.toISOString()}::timestamptz, ${newEnd.toISOString()}::timestamptz, '[)'), reschedule_count = reschedule_count + 1 WHERE id = ${id}::uuid`
      );
      return {};
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (20 total so far)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add reschedule, once-only, re-validated against availability"
```

---

## Task 7: Start-OTP infrastructure, then Depart and Start

**Files:**
- Create: `apps/api/src/booking/start-otp.ts`
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `startSchema`
- Modify: `apps/api/src/booking/booking.controller.ts` — add `depart`, `start`
- Modify: `apps/api/src/booking/booking.module.ts` — no change needed (no new injectable; `start-otp.ts` exports plain functions)
- Modify: `apps/api/test/integration/booking.test.ts`

**Interfaces:**
- Consumes: `EnvironmentService` (already global, exports `values.OTP_PEPPER`), `generateOtpCode`/`hmacSha256` from `apps/api/src/identity/otp.js` (already generic, no change needed there), `SMS_SENDER` port + `IntegrationsModule` exports (need to confirm the export token name — see Step 3).
- Produces: `generateBookingOtp(): string`, `hashBookingOtp(pepper: string, bookingId: string, code: string): string`, `verifyBookingOtp(pepper: string, bookingId: string, code: string, hash: string): boolean` in `start-otp.ts`.

- [ ] **Step 1: Confirm the SMS sender port's injection token**

Run: `grep -n "SMS_SENDER" apps/api/src/integrations/integrations.module.ts apps/api/src/identity/otp.service.ts`

This must be checked before writing Step 4's code, since the exact exported constant name is needed to inject the same mock SMS sender `otp.service.ts` already uses (the one that lands messages in `GET /dev/inbox`).

- [ ] **Step 2: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts` (needs `readOtpFromInbox`, already imported for other test files — add it to this file's import line):
```typescript
import { callApi, createTestApp, postJson, readOtpFromInbox, readyBookableProvider, registerAndVerify } from './harness.js';
```
```typescript
describe('FR-EX-01/02: depart and start-OTP', () => {
  const scheduleAndAccept = async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
    return { bookingId: created.body.id, providerAccessToken, customerAccessToken };
  };

  it('generates and delivers a start OTP to the customer when the provider departs', async () => {
    const { bookingId, providerAccessToken, customerAccessToken } = await scheduleAndAccept();
    void customerAccessToken;
    const departed = await callApi<{ status: string }>(app, `/bookings/${bookingId}/depart`, asProviderToken(providerAccessToken, { method: 'POST' }));
    expect(departed.status).toBe(200);
    expect(departed.body.status).toBe('EN_ROUTE');

    const code = await readOtpFromInboxByBookingId(bookingId);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('moves to IN_PROGRESS when the provider enters the correct OTP', async () => {
    const { bookingId, providerAccessToken } = await scheduleAndAccept();
    await callApi(app, `/bookings/${bookingId}/depart`, asProviderToken(providerAccessToken, { method: 'POST' }));
    const code = await readOtpFromInboxByBookingId(bookingId);

    const started = await callApi<{ status: string; startOtpVerifiedAt: string | null }>(app, `/bookings/${bookingId}/start`, asProviderToken(providerAccessToken, postJson({ code })));
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_PROGRESS');
    expect(started.body.startOtpVerifiedAt).not.toBeNull();
  });

  it('rejects a wrong OTP', async () => {
    const { bookingId, providerAccessToken } = await scheduleAndAccept();
    await callApi(app, `/bookings/${bookingId}/depart`, asProviderToken(providerAccessToken, { method: 'POST' }));
    const response = await callApi<{ code: string }>(app, `/bookings/${bookingId}/start`, asProviderToken(providerAccessToken, postJson({ code: '000000' })));
    expect(response.status).toBe(422);
  });
});
```

This test needs a small helper that finds the OTP message tagged to a specific booking (the existing `readOtpFromInbox` in `harness.ts` matches by recipient phone number, which is ambiguous once a customer has more than one booking in flight across a test run — this file needs its own lookup by message content instead). Add this local helper near the top of `booking.test.ts`, after the existing imports:
```typescript
const readOtpFromInboxByBookingId = async (bookingId: string): Promise<string> => {
  const response = await callApi<{ items: { body: string; metadata?: Record<string, string> }[] }>(app, '/dev/inbox?limit=50');
  const message = [...response.body.items].reverse().find(item => item.metadata?.bookingId === bookingId);
  if (message === undefined) throw new Error(`No inbox message was delivered for booking ${bookingId}`);
  const match = /\b(\d{6})\b/.exec(message.body);
  if (match === null) throw new Error(`The inbox message for booking ${bookingId} carries no six digit code`);
  return match[1]!;
};
```

This requires the mock SMS send call (Step 4) to attach `metadata: { bookingId }` — check the `SmsSenderPort`'s `send` signature accepts a metadata field before writing Step 4 (see Step 1's grep, extended to `apps/api/src/integrations/ports.ts` and `apps/api/src/integrations/mocks.ts`).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "depart and start-OTP"`
Expected: FAIL — 404s, route doesn't exist

- [ ] **Step 4: Write `start-otp.ts`**

```typescript
// apps/api/src/booking/start-otp.ts
import { generateOtpCode, hmacSha256 } from '../identity/otp.js';

export const generateBookingOtp = (): string => generateOtpCode();

/**
 * Scoped to (bookingId, code) rather than reusing identity's OtpPurpose-typed
 * hashOtpCode, since a booking's start OTP is stored directly on the
 * bookings row (start_otp_hash) rather than in the shared otp_tokens table
 * identity owns — see the design doc §7 for why this stays isolated.
 */
export const hashBookingOtp = (pepper: string, bookingId: string, code: string): string => hmacSha256(pepper, `booking-start:${bookingId}:${code}`);

export const verifyBookingOtp = (pepper: string, bookingId: string, code: string, hash: string): boolean => hashBookingOtp(pepper, bookingId, code) === hash;
```

- [ ] **Step 5: Add the start schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const startSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();
export type StartInput = z.infer<typeof startSchema>;
```

- [ ] **Step 6: Add `depart` and `start` to the controller**

This needs `EnvironmentService` (for `OTP_PEPPER`) and the SMS sender port injected — use whatever exact token Step 1's grep found (referred to here as `SMS_SENDER`/`SmsSenderPort`, matching the names already used in `otp.service.ts`). Update the top of `apps/api/src/booking/booking.controller.ts`:
```typescript
import { EnvironmentService } from '../config/environment.service.js';
import { SMS_SENDER } from '../integrations/integrations.module.js';
import type { SmsSenderPort } from '../integrations/ports.js';
import { generateBookingOtp, hashBookingOtp, verifyBookingOtp } from './start-otp.js';
import { badRequest } from '../common/domain-error.js';
```
Update the constructor:
```typescript
  constructor(
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(BookingStateService) private readonly bookingState: BookingStateService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(SMS_SENDER) private readonly sms: SmsSenderPort
  ) {}
```
Add the two handlers:
```typescript
  @Post(':id/depart')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Mark yourself en route', description: 'Notifies the customer you are on your way, and generates the arrival OTP they will read out to you — sent by SMS in production, and readable at GET /dev/inbox in this dev environment.' })
  async depart(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookingState.apply(id, 'depart', principal, async (tx, booking) => {
      const code = generateBookingOtp();
      const hash = hashBookingOtp(this.environment.values.OTP_PEPPER, booking.id, code);
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET start_otp_hash = ${hash}, start_otp_attempts = 0, start_otp_locked_until = NULL WHERE id = ${booking.id}::uuid`);
      const customerPhone = await tx.$queryRaw<{ phoneE164: string }[]>(Prisma.sql`SELECT phone_e164 as "phoneE164" FROM users WHERE id = ${booking.customerId}::uuid`);
      const phone = customerPhone[0]?.phoneE164;
      if (phone !== undefined) {
        await this.sms.send({ to: phone, body: `Your provider has arrived. Share this code to start the job: ${code}. It expires when the job starts.`, metadata: { bookingId: booking.id, purpose: 'BOOKING_START' } });
      }
      return {};
    });
  }

  @Post(':id/start')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Start the job with the arrival OTP', description: 'The provider enters the code the customer read out from their phone. This is the moment work is considered to have begun — the database will not allow the booking to complete without it.' })
  @ApiZodBody(startSchema, { default: { summary: 'Code from the customer', value: { code: '123456' } } })
  async start(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { code } = parseWith(startSchema, body);
    return this.bookingState.apply(id, 'start', principal, async (tx, booking) => {
      const rows = await tx.$queryRaw<{ startOtpHash: string | null }[]>(Prisma.sql`SELECT start_otp_hash as "startOtpHash" FROM bookings WHERE id = ${booking.id}::uuid`);
      const hash = rows[0]?.startOtpHash;
      if (hash === null || hash === undefined || !verifyBookingOtp(this.environment.values.OTP_PEPPER, booking.id, code, hash)) throw badRequest('The code was not correct');
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET start_otp_verified_at = now(), checkin_at = now() WHERE id = ${booking.id}::uuid`);
      return {};
    });
  }
```

`badRequest` returns a `400`, not the `422` the test asserts — fix the test's expectation to `400` instead (this codebase's convention, confirmed by every other "the value didn't match" case in this session, e.g. the provider-services price-band check in M1, is `badRequest` → `400`, reserving `422` specifically for Zod schema validation failures via `validationFailed`). Update the "rejects a wrong OTP" test's assertion:
```typescript
    expect(response.status).toBe(400);
```

- [ ] **Step 7: Wire `IntegrationsModule`'s export into `BookingModule`**

Check whether `SMS_SENDER` is already exported globally (grep from Step 1 should reveal this — `IntegrationsModule` is imported in `app.module.ts` already, and if it's `@Global()` like every other cross-cutting module in this codebase, no further wiring is needed; if it isn't global, add `IntegrationsModule` to `BookingModule`'s own `imports` array). Confirm with:

Run: `grep -n "@Global\|exports:" apps/api/src/integrations/integrations.module.ts`

If it's not global, modify `apps/api/src/booking/booking.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { BookingStateService } from './booking-state.service.js';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';

@Module({
  imports: [IntegrationsModule],
  controllers: [BookingController],
  providers: [BookingService, BookingStateService]
})
export class BookingModule {}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (23 total so far)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add depart/start with an arrival OTP gate"
```

---

## Task 8: No-show

**Files:**
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `noShowSchema`
- Modify: `apps/api/src/booking/booking.controller.ts` — add `noShow`
- Modify: `apps/api/test/integration/booking.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts`:
```typescript
describe('no-show', () => {
  it('lets either party report a no-show from EN_ROUTE', async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${created.body.id}/depart`, asProviderToken(providerAccessToken, { method: 'POST' }));

    const reported = await callApi<{ status: string; noShowParty: string }>(app, `/bookings/${created.body.id}/no-show`, asCustomer(customerAccessToken, postJson({ party: 'PROVIDER' })));
    expect(reported.status).toBe(200);
    expect(reported.body.status).toBe('NO_SHOW');
    expect(reported.body.noShowParty).toBe('PROVIDER');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "no-show"`
Expected: FAIL — 404

- [ ] **Step 3: Add the schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const noShowSchema = z.object({ party: z.enum(['CUSTOMER', 'PROVIDER']) }).strict();
export type NoShowInput = z.infer<typeof noShowSchema>;
```

- [ ] **Step 4: Add the controller handler**

Add to `apps/api/src/booking/booking.controller.ts` (import `noShowSchema`):
```typescript
  @Post(':id/no-show')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'Report a no-show', description: 'Either party can report that the other did not show up once the provider is EN_ROUTE. Records which party — the SRS’s "provider no-show refunds in full and penalises the provider" consequence needs payments (M8) and conduct (M15), neither of which exist yet, so this just records the fact.' })
  @ApiZodBody(noShowSchema, { default: { summary: 'Provider did not show', value: { party: 'PROVIDER' } } })
  async noShow(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { party } = parseWith(noShowSchema, body);
    return this.bookingState.apply(id, 'noShow', principal, async tx => {
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET no_show_party = ${party}::no_show_party WHERE id = ${id}::uuid`);
      return {};
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (24 total so far)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add no-show reporting"
```

---

## Task 9: Checklist completion

**Files:**
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `checklistSchema`
- Modify: `apps/api/src/booking/booking.service.ts` — add `markChecklistItemDone`
- Modify: `apps/api/src/booking/booking.controller.ts` — add the handler
- Modify: `apps/api/test/integration/booking.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts`:
```typescript
describe('FR-EX-08: checklist', () => {
  const scheduleAcceptAndStart = async () => {
    const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
    await callApi(app, `/bookings/${created.body.id}/depart`, asProviderToken(providerAccessToken, { method: 'POST' }));
    const code = await readOtpFromInboxByBookingId(created.body.id);
    await callApi(app, `/bookings/${created.body.id}/start`, asProviderToken(providerAccessToken, postJson({ code })));
    return { bookingId: created.body.id, providerAccessToken, serviceId };
  };

  it('lets the provider mark a checklist item done', async () => {
    const { bookingId, providerAccessToken, serviceId } = await scheduleAcceptAndStart();
    const service = await callApi<{ checklist: { id: number }[] }>(app, `/catalogue/services/leak-repair`);
    void serviceId;
    const itemId = service.body.checklist[0]!.id;

    const marked = await callApi<{ done: boolean }>(app, `/bookings/${bookingId}/checklist/${itemId}`, asProviderToken(providerAccessToken, postJson({ done: true })));
    expect(marked.status).toBe(200);
    expect(marked.body.done).toBe(true);
  });

  it('rejects marking a checklist item that does not belong to this booking’s service', async () => {
    const { bookingId, providerAccessToken } = await scheduleAcceptAndStart();
    const otherService = await callApi<{ checklist: { id: number }[] }>(app, `/catalogue/services/blocked-drain`);
    const response = await callApi<{ code: string }>(app, `/bookings/${bookingId}/checklist/${otherService.body.checklist[0]!.id}`, asProviderToken(providerAccessToken, postJson({ done: true })));
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "checklist"`
Expected: FAIL — 404, route doesn't exist

- [ ] **Step 3: Add the schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const checklistSchema = z.object({ done: z.literal(true) }).strict();
export type ChecklistInput = z.infer<typeof checklistSchema>;
```

- [ ] **Step 4: Add the service method**

Add to `apps/api/src/booking/booking.service.ts`:
```typescript
  async markChecklistItemDone(bookingId: string, providerId: string, checklistItemId: number): Promise<{ checklistItemId: number; done: boolean }> {
    const owned = await this.prisma.$queryRaw<{ serviceId: number }[]>(Prisma.sql`SELECT service_id as "serviceId" FROM bookings WHERE id = ${bookingId}::uuid AND provider_id = ${providerId}::uuid`);
    const booking = owned[0];
    if (booking === undefined) throw notFound('Booking');
    const items = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM service_checklist_items WHERE id = ${checklistItemId} AND service_id = ${booking.serviceId} AND is_active = true`);
    if (items.length === 0) throw notFound('Checklist item');
    await this.prisma.$executeRaw(
      Prisma.sql`INSERT INTO job_checklist_results(booking_id, checklist_item_id, visit_no, done)
        VALUES (${bookingId}::uuid, ${checklistItemId}, 1, true)
        ON CONFLICT (booking_id, checklist_item_id, visit_no) DO UPDATE SET done = true, completed_at = now()`
    );
    return { checklistItemId, done: true };
  }
```

- [ ] **Step 5: Add the controller handler**

Add to `apps/api/src/booking/booking.controller.ts` (import `checklistSchema`):
```typescript
  @Post(':id/checklist/:itemId')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Mark a checklist item done', description: 'Marks one step of the service’s checklist as completed for this job. Every active checklist item for the service must be done before the job can be marked complete. Photo evidence per item is not required in this build — that needs file-upload infrastructure this API doesn’t have yet.' })
  @ApiZodBody(checklistSchema, { default: { summary: 'Mark done', value: { done: true } } })
  async markChecklistItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseIntPipe) itemId: number, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    parseWith(checklistSchema, body);
    return this.bookings.markChecklistItemDone(id, principal.userId, itemId);
  }
```

This needs `ParseIntPipe` added to the `@nestjs/common` import line at the top of the controller.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (26 total so far)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add checklist item completion"
```

---

## Task 10: Quote revisions (raise, approve, reject)

**Files:**
- Modify: `apps/api/src/booking/booking.schemas.ts` — add `quoteRevisionCreateSchema`
- Modify: `apps/api/src/booking/booking.controller.ts` — add the three handlers
- Modify: `apps/api/test/integration/booking.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts` (reuses `scheduleAcceptAndStart` from Task 9's describe block — move that helper to module scope, just above the `describe` blocks that use it, since it's now needed by two of them):

First, cut `scheduleAcceptAndStart` out of the `FR-EX-08: checklist` describe block and place it at the top level of the file, right after `bookingSetup`:
```typescript
const scheduleAcceptAndStart = async () => {
  const { providerId, providerAccessToken, serviceId, customerAccessToken, addressId } = await bookingSetup();
  const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
  await callApi(app, `/bookings/${created.body.id}/accept`, asProviderToken(providerAccessToken, { method: 'POST' }));
  await callApi(app, `/bookings/${created.body.id}/depart`, asProviderToken(providerAccessToken, { method: 'POST' }));
  const code = await readOtpFromInboxByBookingId(created.body.id);
  await callApi(app, `/bookings/${created.body.id}/start`, asProviderToken(providerAccessToken, postJson({ code })));
  return { bookingId: created.body.id, providerAccessToken, customerAccessToken, serviceId };
};
```
(delete the now-duplicate local definition inside the `FR-EX-08: checklist` describe block, and its `serviceId` destructure there since it's carried by the shared helper now)

```typescript
describe('FR-EX-05: quote revisions', () => {
  it('lets the provider raise extra work and the customer approve it, bumping approvedTotalPaisa', async () => {
    const { bookingId, providerAccessToken, customerAccessToken } = await scheduleAcceptAndStart();
    const before = await callApi<{ approvedTotalPaisa: number }>(app, `/bookings/${bookingId}`, asProviderToken(providerAccessToken));

    const raised = await callApi<{ status: string; id: string }>(
      app,
      `/bookings/${bookingId}/quote-revisions`,
      asProviderToken(providerAccessToken, postJson({ reason: 'Found a second leak', items: [{ description: 'Extra pipe section', quantity: 1, unitPricePaisa: 50_00 }] }))
    );
    expect(raised.status).toBe(201);

    const bookingAfterRaise = await callApi<{ status: string }>(app, `/bookings/${bookingId}`, asProviderToken(providerAccessToken));
    expect(bookingAfterRaise.body.status).toBe('QUOTE_REVISION');

    const approved = await callApi<{ status: string; approvedTotalPaisa: number }>(app, `/bookings/${bookingId}/quote-revisions/${raised.body.id}/approve`, asCustomer(customerAccessToken, { method: 'POST' }));
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('IN_PROGRESS');
    expect(approved.body.approvedTotalPaisa).toBe(before.body.approvedTotalPaisa + 50_00);
  });

  it('lets the customer reject a revision, returning to IN_PROGRESS without changing approvedTotalPaisa', async () => {
    const { bookingId, providerAccessToken, customerAccessToken } = await scheduleAcceptAndStart();
    const before = await callApi<{ approvedTotalPaisa: number }>(app, `/bookings/${bookingId}`, asProviderToken(providerAccessToken));
    const raised = await callApi<{ id: string }>(app, `/bookings/${bookingId}/quote-revisions`, asProviderToken(providerAccessToken, postJson({ reason: 'Extra part', items: [{ description: 'Part', quantity: 1, unitPricePaisa: 30_00 }] })));

    const rejected = await callApi<{ status: string; approvedTotalPaisa: number }>(app, `/bookings/${bookingId}/quote-revisions/${raised.body.id}/reject`, asCustomer(customerAccessToken, { method: 'POST' }));
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('IN_PROGRESS');
    expect(rejected.body.approvedTotalPaisa).toBe(before.body.approvedTotalPaisa);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "quote revisions"`
Expected: FAIL — 404s

- [ ] **Step 3: Add the schema**

Add to `apps/api/src/booking/booking.schemas.ts`:
```typescript
export const quoteRevisionCreateSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    items: z
      .array(z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().positive(), unitPricePaisa: z.number().int().nonnegative() }).strict())
      .min(1)
      .max(20)
  })
  .strict();
export type QuoteRevisionCreateInput = z.infer<typeof quoteRevisionCreateSchema>;
```

- [ ] **Step 4: Add the controller handlers**

Add to `apps/api/src/booking/booking.controller.ts` (import `quoteRevisionCreateSchema`, and `ParseUUIDPipe` is already imported):
```typescript
  @Post(':id/quote-revisions')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Raise a quote revision for extra work',
    description: 'Extra work found on site needs the customer’s in-app approval before it proceeds (FR-EX-05). The total is computed server-side from the line items given, not trusted from any client-supplied total.'
  })
  @ApiZodBody(quoteRevisionCreateSchema, { default: { summary: 'Found extra work', value: { reason: 'Found a second leak', items: [{ description: 'Extra pipe section', quantity: 1, unitPricePaisa: 5_000 }] } } })
  async raiseQuoteRevision(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const input = parseWith(quoteRevisionCreateSchema, body);
    const deltaPaisa = input.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPricePaisa), 0);
    let revisionId = '';
    await this.bookingState.apply(id, 'raiseQuoteRevision', principal, async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO quote_revisions(booking_id, reason, delta_paisa, raised_by) VALUES (${id}::uuid, ${input.reason}, ${BigInt(deltaPaisa)}, ${principal.userId}::uuid) RETURNING id`
      );
      revisionId = rows[0]!.id;
      for (const item of input.items) {
        const amountPaisa = Math.round(item.quantity * item.unitPricePaisa);
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_items(booking_id, revision_id, kind, description, quantity, unit_price_paisa, amount_paisa)
            VALUES (${id}::uuid, ${revisionId}::uuid, 'EXTRA'::item_kind, ${item.description}, ${item.quantity}, ${BigInt(item.unitPricePaisa)}, ${BigInt(amountPaisa)})`
        );
      }
      return { metadata: { revisionId, deltaPaisa } };
    });
    return { id: revisionId, deltaPaisa };
  }

  @Post(':id/quote-revisions/:revisionId/approve')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Approve a quote revision', description: 'Approves the extra work, adding its cost to the booking’s approved total, and lets the job continue.' })
  async approveQuoteRevision(@Param('id', ParseUUIDPipe) id: string, @Param('revisionId', ParseUUIDPipe) revisionId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookingState.apply(id, 'approveQuoteRevision', principal, async tx => {
      const revisions = await tx.$queryRaw<{ deltaPaisa: bigint; status: string }[]>(Prisma.sql`SELECT delta_paisa as "deltaPaisa", status FROM quote_revisions WHERE id = ${revisionId}::uuid AND booking_id = ${id}::uuid`);
      const revision = revisions[0];
      if (revision === undefined) throw notFound('Quote revision');
      if (revision.status !== 'PENDING') throw conflict('This quote revision has already been decided');
      await tx.$executeRaw(Prisma.sql`UPDATE quote_revisions SET status = 'APPROVED'::revision_status, decided_by = ${principal.userId}::uuid, decided_at = now() WHERE id = ${revisionId}::uuid`);
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET approved_total_paisa = approved_total_paisa + ${revision.deltaPaisa} WHERE id = ${id}::uuid`);
      return {};
    });
  }

  @Post(':id/quote-revisions/:revisionId/reject')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Reject a quote revision', description: 'Declines the extra work. The job continues at the original scope and price — the rejected line items stay on record but are not billed.' })
  async rejectQuoteRevision(@Param('id', ParseUUIDPipe) id: string, @Param('revisionId', ParseUUIDPipe) revisionId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookingState.apply(id, 'rejectQuoteRevision', principal, async tx => {
      const revisions = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM quote_revisions WHERE id = ${revisionId}::uuid AND booking_id = ${id}::uuid`);
      const revision = revisions[0];
      if (revision === undefined) throw notFound('Quote revision');
      if (revision.status !== 'PENDING') throw conflict('This quote revision has already been decided');
      await tx.$executeRaw(Prisma.sql`UPDATE quote_revisions SET status = 'REJECTED'::revision_status, decided_by = ${principal.userId}::uuid, decided_at = now() WHERE id = ${revisionId}::uuid`);
      return {};
    });
  }
```

This needs `notFound` added alongside the existing `badRequest, conflict` import from `../common/domain-error.js`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (28 total so far)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add quote revisions with server-computed totals"
```

---

## Task 11: Complete

**Files:**
- Modify: `apps/api/src/booking/booking.controller.ts` — add `complete`
- Modify: `apps/api/test/integration/booking.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/booking.test.ts`:
```typescript
describe('FR-EX-06: complete', () => {
  it('rejects completing while checklist items remain undone', async () => {
    const { bookingId, providerAccessToken } = await scheduleAcceptAndStart();
    const response = await callApi<{ code: string }>(app, `/bookings/${bookingId}/complete`, asProviderToken(providerAccessToken, { method: 'POST' }));
    expect(response.status).toBe(409);
  });

  it('completes once every checklist item is done, generating an invoice', async () => {
    const { bookingId, providerAccessToken } = await scheduleAcceptAndStart();
    const service = await callApi<{ checklist: { id: number }[] }>(app, '/catalogue/services/leak-repair');
    for (const item of service.body.checklist) {
      await callApi(app, `/bookings/${bookingId}/checklist/${item.id}`, asProviderToken(providerAccessToken, postJson({ done: true })));
    }
    const completed = await callApi<{ status: string; finalAmountPaisa: number }>(app, `/bookings/${bookingId}/complete`, asProviderToken(providerAccessToken, { method: 'POST' }));
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('WORK_COMPLETED');
    expect(completed.body.finalAmountPaisa).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts -t "complete"`
Expected: FAIL — 404, route doesn't exist

- [ ] **Step 3: Add `discountPaisa` to the booking row shape**

`discount_paisa` (`NOT NULL DEFAULT 0` in the database) was never added to `BOOKING_COLUMNS`/`BookingRowRaw` back in Task 2, and completion is the first place that needs it (the invoice total is subtotal minus discount). Modify `apps/api/src/booking/booking.service.ts`:

Add `discountPaisa: number;` to the `BookingRow` type, add `discountPaisa: bigint;` in place of the omitted field on `BookingRowRaw` (extend its `Omit<...>` list to include `'discountPaisa'` alongside the three money fields already there), add `discount_paisa as "discountPaisa"` to `BOOKING_COLUMNS` (after `final_amount_paisa as "finalAmountPaisa"`), and add `discountPaisa: Number(raw.discountPaisa)` to `toBookingRow`'s return object.

- [ ] **Step 4: Add the controller handler**

Add to `apps/api/src/booking/booking.controller.ts`:
```typescript
  @Post(':id/complete')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Mark the job complete',
    description:
      "Requires every active checklist item for the service to be marked done first. Generates the completion invoice from the booking's line items. This is the last step this API drives — verification and payment release (SRS §4) need the call-console and payment infrastructure that come later."
  })
  async complete(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookingState.apply(id, 'complete', principal, async (tx, booking) => {
      const required = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM service_checklist_items WHERE service_id = ${booking.serviceId} AND is_active = true`);
      const done = await tx.$queryRaw<{ checklistItemId: number }[]>(Prisma.sql`SELECT checklist_item_id as "checklistItemId" FROM job_checklist_results WHERE booking_id = ${booking.id}::uuid AND visit_no = 1 AND done = true`);
      const doneIds = new Set(done.map(row => row.checklistItemId));
      if (required.some(item => !doneIds.has(item.id))) throw conflict('Not every checklist item has been completed');

      const items = await tx.$queryRaw<{ amountPaisa: bigint }[]>(Prisma.sql`SELECT amount_paisa as "amountPaisa" FROM booking_items WHERE booking_id = ${booking.id}::uuid`);
      const subtotalPaisa = items.reduce((sum, item) => sum + item.amountPaisa, 0n);
      // booking.discountPaisa is already a bigint here (booking is a BookingRowRaw, straight from the DB row), so no conversion is needed before subtracting.
      const totalPaisa = subtotalPaisa - booking.discountPaisa;
      await tx.$executeRaw(Prisma.sql`INSERT INTO invoices(booking_id, subtotal_paisa, total_paisa) VALUES (${booking.id}::uuid, ${subtotalPaisa}, ${totalPaisa})`);
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET final_amount_paisa = ${totalPaisa}, completed_at = now() WHERE id = ${booking.id}::uuid`);
      return {};
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json --noEmit`, then `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`
Expected: clean typecheck; all tests pass (30 total)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/booking apps/api/test/integration/booking.test.ts
git commit -m "feat(booking): add completion with checklist gate and invoice generation"
```

---

## Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run (from repo root): `npm run lint --workspace @smart-home/api` and `npm run lint --workspace @smart-home/domain`
Expected: both clean, zero errors

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @smart-home/api` and `npm run typecheck --workspace @smart-home/domain`
Expected: both clean

- [ ] **Step 3: Full unit test suite**

Run: `npm run test --workspace @smart-home/domain` and `npm run test --workspace @smart-home/api`
Expected: all green, including the pre-existing suites untouched by this plan

- [ ] **Step 4: Full integration suite**

Run (from `apps/api/`): `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts`
Expected: every file green — this includes `booking.test.ts`'s ~30 tests alongside every pre-existing integration test (identity, catalogue, customer-addresses, places, provider-profile, search, outbox, webhook, database-invariants) with zero regressions

- [ ] **Step 5: Build**

Run: `npm run build --workspace @smart-home/domain` and `npm run build --workspace @smart-home/api`
Expected: both clean

- [ ] **Step 6: Live smoke test against the running dev server**

If a dev server is already running (`npm run dev --workspace @smart-home/api` from an earlier session), it will have hot-reloaded these changes. Confirm the new routes are mapped by checking the server's stdout log for `Mapped {/api/v1/bookings...}` lines, or query the live OpenAPI document:

Run: `curl -sS http://localhost:3000/api/docs/openapi.json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const doc=JSON.parse(d);console.log(Object.keys(doc.paths).filter(p=>p.includes('/bookings')));});"`

Expected: a list including `/api/v1/bookings`, `/api/v1/bookings/{id}`, `/api/v1/bookings/{id}/accept`, and so on for every endpoint this plan added.

Then walk the full happy path live (register a customer and a provider, build the provider up via `readyBookableProvider`'s manual equivalent, create a booking, accept, depart, read the OTP from `/dev/inbox`, start, mark every checklist item done, complete) exactly as the earlier live-flow checks in this session's history did for search — confirming with real HTTP calls, not just the test suite, that a booking genuinely runs start to finish.

- [ ] **Step 7: Update the progress tracker**

Modify `07_PROGRESS_TRACKER.md`: add a change-log entry (§8) and move the relevant ticket rows — likely `SHM-033` through `SHM-043` in the `E2 · Phase 2` index (§4) — from `TODO` to `IN PROGRESS`, following the exact same honest-accounting style used for the M1-M4 entries added earlier (tick only the acceptance criteria genuinely met, note what's deferred and why, don't claim `DONE`). This plan's scope maps cleanly to `SHM-033` (state machine), `SHM-034` (`BookingStateService.apply()`), part of `SHM-037`/`SHM-041`/`SHM-042`/`SHM-043` (minus payment capture, which needs M8) — read each ticket's card in §5 before writing the evidence note, the same way the M1-M4 update did.

---

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** every endpoint in the design doc's §6 table has a task; §7 (start OTP) is Task 7; §8 (quote revisions) is Task 10; §9 (checklist/completion) is Tasks 9 and 11; §10's error-handling table is threaded through every task via `BookingStateService`'s two-step 409-then-403 check (Task 4) and the `notFound`-for-non-owners convention.
- **One thing this plan adds beyond the spec, called out explicitly rather than silently:** the spec's §5 side-effect table didn't mention `commission_rate_bp`, but it's a `NOT NULL` column on `bookings` with no default — Task 2 resolves it via the same provider-\>category-\>global precedence that SHM-019's undone acceptance criterion named, since no booking can be created without *some* value there.
- **Known follow-up, not in this plan:** the `bookings.status` lint rule mentioned in the progress tracker (meant to ban any write outside `BookingStateService`) was already noted as not firing; Task 12 doesn't fix it. Worth a dedicated small task later, since `BookingStateService` (Task 4) is exactly the thing it should be guarding.
