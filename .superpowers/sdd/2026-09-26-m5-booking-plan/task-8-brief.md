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

