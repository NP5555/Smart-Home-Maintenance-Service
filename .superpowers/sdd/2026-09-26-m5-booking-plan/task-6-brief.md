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

