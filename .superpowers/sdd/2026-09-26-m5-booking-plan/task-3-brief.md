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

