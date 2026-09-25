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

