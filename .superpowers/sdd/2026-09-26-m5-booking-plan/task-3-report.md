# Task 3: Read bookings (`GET /bookings/:id`, `GET /bookings`)

## Implementation Summary

Successfully implemented two read-only GET endpoints for the booking module, following the exact specifications in task-3-brief.md. All work was completed using TDD (test-first) methodology.

## Files Modified

1. `apps/api/src/booking/booking.schemas.ts`
   - Added `bookingListQuerySchema` with Zod validation for optional status filter
   - Added `BookingListQuery` type export

2. `apps/api/src/booking/booking.service.ts`
   - Added `getOwned(bookingId: string, actorUserId: string): Promise<BookingRow>` — retrieves a booking if the caller is its customer or provider, throws `notFound()` otherwise
   - Added `listMine(actorUserId: string, status?: string): Promise<BookingRow[]>` — lists all bookings where caller is customer or provider, optionally filtered by status, ordered by `created_at DESC`

3. `apps/api/src/booking/booking.controller.ts`
   - Updated imports: added `Get, Param, ParseUUIDPipe, Query` from `@nestjs/common`
   - Updated imports: added `ApiQueryField` from common swagger utilities
   - Updated imports: added `bookingListQuerySchema` from booking.schemas
   - Added `@Get(':id')` handler with UUID validation and @PolicyDecorator role checks
   - Added `@Get()` handler with query parameter support and response wrapping in `{ items: ... }`

## TDD Evidence

### RED Phase (Tests Fail)
```
RUN  v3.2.7 /Users/apple/Downloads/Smart-Home-Maintenance-Service-main/apps/api

 ✗ reading bookings > lets the customer and the provider both read a booking they are part of
   → expected 404 to be 200
 ✗ reading bookings > lists a customer's own bookings
   → Cannot read properties of undefined (reading 'map')

Test Files  1 failed (1)
Tests  2 failed | 1 passed | 6 skipped (9)
```

Initial test run showed:
- First test expected 200 but got 404 (route doesn't exist)
- Third test got undefined for `listed.body.items` (no handler)
- Second test passed trivially (expecting 404, got 404 from nonexistent route)

### GREEN Phase (Tests Pass)
```
✓ test/integration/booking.test.ts (9 tests) 2909ms
  ✓ FR-BK-01/02/04: create a booking > lets a customer request a specific, ready provider for a service at a chosen time  354ms
  ✓ FR-BK-01/02/04: create a booking > rejects a second overlapping request for the same provider with CONFLICT  424ms
  ✓ FR-BK-01/02/04: create a booking > rejects a time outside the provider's declared availability
  ✓ FR-BK-01/02/04: create a booking > rejects a service the provider does not offer
  ✓ FR-BK-01/02/04: create a booking > rejects an address that does not belong to the requesting customer
  ✓ FR-BK-01/02/04: create a booking > rejects booking writes from a signed in provider
  ✓ reading bookings > lets the customer and the provider both read a booking they are part of
  ✓ reading bookings > hides a booking from someone who is neither its customer nor its provider
  ✓ reading bookings > lists a customer's own bookings

Test Files  1 passed (1)
Tests  9 passed (9)
```

All 9 tests pass:
- 6 original tests from Task 2 (create booking)
- 3 new tests from Task 3 (read bookings)

### Typecheck
```
$ npx tsc -p tsconfig.json --noEmit
(no output — clean pass)
```

## Self-Review Findings

### Completeness ✅
- Both endpoints implemented: `GET /bookings/:id` and `GET /bookings`
- Both test cases from brief added and passing
- All required files modified correctly

### Quality ✅
- **House style match**: All code follows existing patterns exactly
  - Raw `Prisma.sql` queries (not ORM/queryBuilder)
  - Explicit `@Inject(PrismaService)` constructor pattern
  - Zod validation with `parseWith()` helper
  - `notFound()` error helper for domain exceptions
  - Proper type conversion with `toBookingRow()`
  - Correct use of `BOOKING_COLUMNS` constant
  
- **Decorators and validation**:
  - `@PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })` on both handlers
  - `ParseUUIDPipe` on `:id` parameter for strong validation
  - `@ApiQueryField` for Swagger documentation
  - `@ApiOperation` with descriptive summaries
  
- **Security**:
  - `getOwned()` hides bookings from non-owners (returns 404)
  - `listMine()` only returns bookings where user is customer or provider
  - Role-based access control via @PolicyDecorator

### Testing ✅
- **No regressions**: All 6 Task 2 tests still pass
- **New tests all pass**: 3 new tests added and passing
- **Test quality**: Proper setup, assertions, and edge cases (authorization, listing, single read)
- **Test output pristine**: Only expected database error log for exclusion constraint test

## Concerns

None. Implementation is complete, correct, and follows all established patterns.
