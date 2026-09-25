# Task 2 report: Booking creation (`POST /bookings`)

## What was implemented

Created `apps/api/src/booking/` with `booking.schemas.ts`, `booking.service.ts`, `booking.controller.ts`, `booking.module.ts`, wired `BookingModule` into `app.module.ts` and a `booking` Swagger tag into `http-app.ts`, added `readyBookableProvider()` to `apps/api/test/integration/harness.ts`, and wrote `apps/api/test/integration/booking.test.ts`. Implementation follows the brief's code exactly, with one deliberate deviation (see below).

### Deviation from the brief

The brief's `booking.service.ts` code throws `badRequest(...)` (→ `BAD_REQUEST`, HTTP 400 per `packages/contracts/src/errors.ts`) when the requested slot falls outside the provider's declared availability. But the brief's own test for that case asserts `status === 422` and `body.code === 'VALIDATION_FAILED'`. Those two pieces of the brief contradict each other — `badRequest` cannot produce a 422/VALIDATION_FAILED response.

I resolved this in favor of the test (which encodes the actual required behavior) by changing that one check to use `validationFailed([{ path: 'scheduledStart', code: 'outside_availability', message: "..." }])` instead of `badRequest(...)`. This is the only line in `booking.service.ts` that differs from the brief's literal snippet; the same-calendar-day check and the time-off check still use `badRequest` as written (untested by this brief, so left as specified). Confirmed `validationFailed`/`VALIDATION_FAILED` is otherwise only used by `parseWith` for Zod failures elsewhere in the codebase, so this is a slight house-style stretch, but it's what the brief's own test requires to pass.

Everything else — schema, controller, module, harness helper, app/http wiring — matches the brief's code verbatim, checked line-by-line against the actual current contents of `app.module.ts`, `http-app.ts`, and `harness.ts` before editing.

## TDD evidence

**RED** — `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts` (run before any `booking/` source files existed):
```
Test Files  1 failed (1)
     Tests  4 failed | 2 passed (6)
```
The 4 explicit failures were all `expected 404 to be <201|409|422|403>` (no `/bookings` route existed). The 2 "passes" were the NOT_FOUND-expecting cases (service-not-offered, address-not-owned), which coincidentally got 404 from the unmatched route too — consistent with what the brief predicted.

**GREEN** — same command, after implementation:
```
 ✓ test/integration/booking.test.ts (6 tests) 2106ms
   ✓ lets a customer request a specific, ready provider for a service at a chosen time  331ms
   ✓ rejects a second overlapping request for the same provider with CONFLICT  423ms
   ✓ rejects a time outside the provider's declared availability
   ✓ rejects a service the provider does not offer
   ✓ rejects an address that does not belong to the requesting customer  387ms
   ✓ rejects booking writes from a signed in provider

 Test Files  1 passed (1)
      Tests  6 passed (6)
```
One expected stderr line appears during the CONFLICT test: Prisma logs the caught `23P01` exclusion-constraint violation at `error` level (the `PrismaService` is configured with `log: ['warn', 'error']`, matching the pre-existing pattern in `provider/time-off.service.ts`, which handles the same exclusion constraint the same way). This is not new noise introduced by this task — it's inherent to how the existing Prisma logging config surfaces a caught-and-handled DB error.

Also ran `npx tsc -p tsconfig.json --noEmit` — clean, no errors.

Ran the existing `search.test.ts` suite afterward (shares the touched `app.module.ts`/`http-app.ts`) to check for regressions: 7/7 still pass.

## Files created

- `apps/api/src/booking/booking.schemas.ts`
- `apps/api/src/booking/booking.service.ts`
- `apps/api/src/booking/booking.controller.ts`
- `apps/api/src/booking/booking.module.ts`
- `apps/api/test/integration/booking.test.ts`

## Files modified

- `apps/api/src/app.module.ts` — added `BookingModule` import and registration in the `imports` array
- `apps/api/src/http-app.ts` — added the `booking` Swagger tag
- `apps/api/test/integration/harness.ts` — added `readyBookableProvider()`

## Self-review

- **Completeness:** every step in the brief done, including the three wiring edits (verified against actual current file contents before editing, not blind-pasted).
- **Quality:** matches house style from `catalogue.service.ts` / `catalogue-admin.controller.ts` — raw `Prisma.sql`, explicit `@Inject`, `parseWith`/Zod, `DomainError` helpers, money as bigint in SQL / number at the boundary via `toBookingRow`. The `EXCLUSION_VIOLATION` → `conflict()` pattern mirrors `provider/time-off.service.ts` exactly.
- **Discipline:** added nothing beyond what the brief specified, aside from the one `badRequest`→`validationFailed` swap needed to make the brief's own test pass (documented above).
- **Testing:** all 6 assertions run against a real Postgres (via `docker compose -f infra/docker-compose.yml`, already up), no mocks. Confirmed RED failed for the right reason (404, no route) before implementing, then GREEN.

## Concerns

- The `badRequest`→`validationFailed` change is a judgment call resolving an internal contradiction in the brief, not a literal implementation of the given code. Flagging it explicitly so the controller/reviewer can confirm this is the intended behavior (VALIDATION_FAILED/422 for "outside declared availability") rather than BAD_REQUEST/400. If BAD_REQUEST/400 was actually intended, the test in the brief needs correcting instead.
- No other concerns; typecheck and both integration suites (`booking.test.ts`, `search.test.ts`) are clean.

## Fix note (post-ruling)

The coordinator ruled: `badRequest()`/400 is correct, not `validationFailed()`/422. This codebase reserves `validationFailed`/422 for Zod schema-shape failures (via `parseWith`) and `badRequest`/400 for business-rule violations discovered at runtime — matching the established convention already visible in the catalogue module. An out-of-availability slot is a business-rule violation, not a schema failure, so it belongs on `badRequest`/400.

**Changes made:**
- `apps/api/src/booking/booking.service.ts` — reverted the availability check back to `throw badRequest("The requested time falls outside the provider's declared availability")`; dropped the now-unused `validationFailed` import (back to `import { badRequest, conflict, notFound } from '../common/domain-error.js';`).
- `apps/api/test/integration/booking.test.ts` — the "rejects a time outside the provider's declared availability" test now asserts `expect(response.status).toBe(400)` and `expect(response.body.code).toBe('BAD_REQUEST')` (was 422/VALIDATION_FAILED).

**Verification:**
- `npx tsc -p tsconfig.json --noEmit` — clean, no errors.
- `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`:
```
 ✓ test/integration/booking.test.ts (6 tests) 2077ms
   ✓ lets a customer request a specific, ready provider for a service at a chosen time  327ms
   ✓ rejects a second overlapping request for the same provider with CONFLICT  418ms
   ✓ rejects a time outside the provider's declared availability
   ✓ rejects a service the provider does not offer
   ✓ rejects an address that does not belong to the requesting customer  427ms
   ✓ rejects booking writes from a signed in provider

 Test Files  1 passed (1)
      Tests  6 passed (6)
```
Same expected `prisma:error` stderr line on the CONFLICT test as before (pre-existing logging behavior from `PrismaService`'s `log: ['warn', 'error']` config, not new noise).

This resolves the concern raised above — no remaining open questions.

## Fix note (review round: transactional write)

Code review flagged an Important finding: `BookingService.create`'s three writes (the `bookings` INSERT, the `booking_items` INSERT, the `booking_status_history` INSERT) ran as three separate statements with no `$transaction` wrapper, risking an orphaned `bookings` row if the 2nd or 3rd statement failed after the 1st succeeded. The reviewer pointed to `apps/api/src/provider/availability.service.ts`'s `replaceMine` as the codebase's existing convention: `this.prisma.$transaction(async tx => {...})`, using `tx` for every statement inside.

**Change made:** in `apps/api/src/booking/booking.service.ts`, wrapped all three writes in `this.prisma.$transaction(async tx => { ... })`, replacing `this.prisma.$queryRaw`/`this.prisma.$executeRaw` with `tx.$queryRaw`/`tx.$executeRaw` for the `bookings` insert, the `booking_items` insert, and the `booking_status_history` insert, and returning `toBookingRow(row)` from inside the transaction callback. The existing outer `try { ... } catch (error) { ... EXCLUSION_VIOLATION ... }` block is kept wrapping the whole `$transaction(...)` call, so the exclusion-constraint-violation → `conflict()` mapping still works exactly as before (Postgres raises `23P01` on the `bookings` insert, which now happens inside `tx` but still propagates out through the transaction promise's rejection to the same `catch`).

Two Minor findings from the same review (provider_services queried twice; missing direct test coverage for provider_time_off blocking, cross-midnight rejection, and unapproved-binding-vs-not-offered) were explicitly deferred by the coordinator and not acted on here.

**Verification:**
- `npx tsc -p tsconfig.json --noEmit` — clean, no errors.
- `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts test/integration/booking.test.ts`:
```
 ✓ test/integration/booking.test.ts (6 tests) 2113ms
   ✓ lets a customer request a specific, ready provider for a service at a chosen time  356ms
   ✓ rejects a second overlapping request for the same provider with CONFLICT  447ms
   ✓ rejects a time outside the provider's declared availability
   ✓ rejects a service the provider does not offer
   ✓ rejects an address that does not belong to the requesting customer  391ms
   ✓ rejects booking writes from a signed in provider

 Test Files  1 passed (1)
      Tests  6 passed (6)
```
Same expected `prisma:error` stderr line on the CONFLICT test (pre-existing `PrismaService` `log: ['warn', 'error']` behavior, unrelated to this change).
