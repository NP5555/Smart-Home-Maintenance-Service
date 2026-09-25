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

