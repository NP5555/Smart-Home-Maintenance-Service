# SDD ledger — plan: docs/superpowers/plans/2026-09-26-m5-booking-plan.md
Adapted: no git repository available in this project — no worktree, no per-task commits, no BASE/HEAD diffs. Review packages are full-contents-of-touched-files instead of diffs. Ledger + briefs + reports still used for isolation and recovery.

## Pre-flight scan

Spec: docs/superpowers/specs/2026-09-26-m5-booking-design.md (read; plan traced against it during writing).

| Pair | Producer -> Consumer | Checked | Result |
|---|---|---|---|
| T1 -> T4 | `BookingActorRole`, `BookingStatus`, `BookingEvent`, `transitionFor`, `canTransition` exported from `@smart-home/domain` | signatures match T4's import/usage | clean |
| T2 -> T3,T4,T5,T6,T7,T9,T10,T11 | `BOOKING_COLUMNS`, `BookingRow`, `BookingRowRaw`, `toBookingRow` in booking.service.ts | field names consistent (scheduledStart, rescheduleCount, noShowParty, cancelReason, startOtpVerifiedAt, discountPaisa) across every later task's usage | clean |
| T4 -> T5-T11 | `BookingStateService.apply(bookingId, event, actor, effect?)` | call sites in T5-T11 all match this signature | clean |
| T2 -> T4 | `bookingSetup()` test helper | T4 extends its return shape (+providerAccessToken); non-breaking for T3's earlier subset-destructure | clean, sequential-only edit noted in T4 brief |
| T2 -> T6 | `create()`'s inline availability/time-off block | T6 extracts it into `assertWindowIsBookable()`, reused by both; edit explicit in T6 brief | clean, planned modification |
| T9 -> T10 | `scheduleAcceptAndStart()` test helper | defined in T9, promoted to module scope by T10 per T10's own brief text | clean, planned modification |
| T2 -> T11 | `BookingRow`/`BookingRowRaw`/`BOOKING_COLUMNS`/`toBookingRow` | T11 adds `discountPaisa` field to all four, per T11's own brief text | clean, planned modification |
| money handling | BigInt() wrapping convention (catalogue.service.ts precedent) | fixed during self-review: T10's quote-revision inserts now wrap deltaPaisa/unitPricePaisa/amountPaisa in BigInt() before Prisma.sql | fixed pre-dispatch |
| Global Constraints | raw Prisma.sql / @Inject / Zod+parseWith / DomainError helpers / ApiZodBody+ApiQueryField / TDD / tsc-clean-per-task | authored directly against these constraints; no violations found | clean |

Scan clean (one issue found and fixed during plan self-review, before this dispatch phase: BigInt wrapping in T10). Proceeding to Task 1.

Task 1: minor (deferred): decline/reschedule/noShow transitions have no direct unit-test coverage in bookingTransitions.test.ts (not required by brief's edge-case list)
Task 1: minor (deferred): BOOKING_TRANSITIONS is exported beyond the brief's named 4-type/2-function interface list (plan-mandated, brief's own Step 3 code exports it)
Task 1: complete (no commits — no git repo; files: packages/domain/src/bookingTransitions.ts, packages/domain/test/bookingTransitions.test.ts, packages/domain/src/index.ts; review clean)

Task 2: Ruling: brief's booking.service.ts code throws badRequest(...) (400) for an out-of-availability slot, but the brief's own test asserted 422/VALIDATION_FAILED for the same case — internally contradictory. Ruling: badRequest/400 is correct (matches this codebase's established convention: badRequest=400 for business-rule violations, validationFailed=422 reserved for Zod schema-shape failures only — e.g. M1's provider price-band check uses badRequest/400). The TEST is wrong, not the service code. Cost if wrong: a client checks for the wrong status code on this one validation path; trivial to correct later, no data/integrity risk.

Task 2: minor (deferred): provider_services queried twice (status check, then price fetch) - could be one query
Task 2: minor (deferred): no direct test coverage for provider_time_off blocking, cross-midnight rejection, or unapproved-binding-vs-not-offered distinction (code verified correct by reviewer via reading; brief itself scoped tests to 6 cases)
Task 2: fix round 1/5 (dispatching) - Important: BookingService.create's 3 writes (bookings/booking_items/booking_status_history) not wrapped in $transaction, unlike established convention in availability.service.ts
Task 2: complete (no commits — no git repo; files: booking.schemas.ts, booking.service.ts, booking.controller.ts, booking.module.ts, booking.test.ts, app.module.ts, http-app.ts, harness.ts; fix round 1/5 addressed, review clean)
