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

