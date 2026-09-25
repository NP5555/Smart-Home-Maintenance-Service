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

