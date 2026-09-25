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

