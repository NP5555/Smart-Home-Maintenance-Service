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

