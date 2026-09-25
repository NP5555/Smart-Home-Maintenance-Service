# M5/M6 — Booking Lifecycle & Work Execution: Design

Status: approved by product owner (evidence-upload cut confirmed 2026-09-26), ready for implementation planning.

## 1. Context

M1 (catalogue), M2 (customer addresses), M3 (provider profile/availability/service-areas/approval)
and M4 (search) are built and live-verified. This spec covers the next piece: a customer can
actually book a specific provider found through search, the provider can act on it, and the job
can be carried out end to end through `WORK_COMPLETED`. Verification, escrow and payment release
(SRS §4, M7/M8) are out of scope — they need call-console and payment-gateway infrastructure that
doesn't exist yet, and `WORK_COMPLETED` is a clean stopping point: SRS §5.2 defines it as "the
provider has submitted completion evidence and the final amount," which is exactly where this
spec ends.

## 2. Scope

**In scope**, mapped to the SRS booking lifecycle (`smart-home-docs/01_SRS_v2.1.md` §5, §6.5, §6.6):

- `REQUESTED → SCHEDULED → EN_ROUTE → IN_PROGRESS → [QUOTE_REVISION] → WORK_COMPLETED`
- Branches: `UNFULFILLED` (provider declines), `CANCELLED_CUSTOMER`/`CANCELLED_PROVIDER` (from
  `SCHEDULED`), `NO_SHOW` (from `EN_ROUTE`)
- Reschedule (once, free, >4h before the slot)
- Start-of-work OTP gate (FR-EX-02)
- Checklist completion (FR-EX-08, without the photo-evidence sub-requirement — see §9)
- Quote revisions for extra work discovered on site (FR-EX-05), with customer approve/reject
- Completion invoice generation from `booking_items` (FR-EX-06)

**Out of scope, explicitly deferred, not silently dropped:**

- Auto-assign / ranked-offer cascade (FR-SR-07) — named-provider booking only this round
- The 15-minute REQUESTED auto-expiry background job — explicit accept/decline only
- `GET /providers/:id/slots` slot-generator endpoint — booking creation validates a
  customer-chosen time against availability/time-off/overlap instead
- Photo evidence upload (`job_evidence` needs multipart file upload, which isn't wired into
  `http-app.ts` anywhere yet) — checklist items get marked done without an attached photo
- `payment_mode: ONLINE` — cash only, since there's no payment gateway (M8) to actually capture
  an online payment yet
- Everything from `AWAITING_VERIFICATION` onward (M7/M8/M9)
- Masked in-booking chat (FR-BK-07)

## 3. Data model — already exists, no migration needed

Every table this spec needs was already created by `0001_init.sql`: `bookings`, `booking_items`,
`booking_status_history`, `quote_revisions`, `job_checklist_results`, `invoices`. Confirmed
constraints on `bookings` that the design below must satisfy (from the migration, not just the
Prisma-introspected schema, since Prisma can't represent exclusion constraints):

```sql
CHECK (scheduled_end > scheduled_start)
CHECK (final_amount_paisa IS NULL OR final_amount_paisa <= approved_total_paisa)
CHECK (approved_total_paisa >= quoted_amount_paisa)
CHECK (status NOT IN ('WORK_COMPLETED', ...) OR start_otp_verified_at IS NOT NULL)
CHECK (status NOT IN ('ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION','WORK_COMPLETED')
       OR provider_id IS NOT NULL)
CONSTRAINT bookings_no_provider_overlap EXCLUDE USING gist (provider_id WITH =, slot WITH &&)
  WHERE (status IN ('PENDING_PAYMENT','REQUESTED','ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION'))
```

Two design decisions fall directly out of these:

- **The slot locks at `REQUESTED`, not at acceptance.** The exclusion constraint's `WHERE` clause
  includes `REQUESTED`, so the DB itself refuses a second overlapping request for the same
  provider the moment the first is created — this is the actual double-booking guarantee (FR-BK-02),
  application code doesn't need to re-implement it, only handle the `23P01` exclusion-violation
  error gracefully (same pattern as `provider_time_off`, already proven in M3).
- **`start_otp_verified_at` is mandatory before `WORK_COMPLETED`.** Not optional, not something the
  service layer can skip — the database enforces it, so the `IN_PROGRESS` transition (start-OTP
  check) is a hard gate on everything downstream.

`ACCEPTED` and `PENDING_PAYMENT`/`ABANDONED` are real enum values this spec doesn't use: `ACCEPTED`
is reserved for a future auto-assign flow where "provider accepted" and "slot locked" genuinely
differ; `PENDING_PAYMENT`/`ABANDONED` belong to the online-checkout flow this spec cuts.

## 4. State machine — `packages/domain/src/bookingTransitions.ts`

Pure, DB-free, same style as `slaCalendar.ts` (plain functions, no classes). A transition table
keyed by `[fromStatus, event]`, each entry naming the resulting status and which actor roles may
fire it:

```ts
export type BookingEvent =
  | 'accept' | 'decline' | 'cancel' | 'reschedule'
  | 'depart' | 'start' | 'raiseQuoteRevision' | 'approveQuoteRevision'
  | 'rejectQuoteRevision' | 'complete' | 'noShow';

export type BookingTransition = { to: BookingStatus; allowedRoles: readonly ActorRole[] };

export const BOOKING_TRANSITIONS: Record<BookingStatus, Partial<Record<BookingEvent, BookingTransition>>> = {
  REQUESTED: {
    accept: { to: 'SCHEDULED', allowedRoles: ['PROVIDER'] },
    decline: { to: 'UNFULFILLED', allowedRoles: ['PROVIDER'] }
  },
  SCHEDULED: {
    // target status (CANCELLED_CUSTOMER vs CANCELLED_PROVIDER) is resolved from actor.role by the service, not encoded here
    cancel: { to: 'CANCELLED_CUSTOMER', allowedRoles: ['CUSTOMER', 'PROVIDER'] },
    reschedule: { to: 'SCHEDULED', allowedRoles: ['CUSTOMER'] },
    depart: { to: 'EN_ROUTE', allowedRoles: ['PROVIDER'] }
  },
  EN_ROUTE: {
    start: { to: 'IN_PROGRESS', allowedRoles: ['PROVIDER'] },
    noShow: { to: 'NO_SHOW', allowedRoles: ['CUSTOMER', 'PROVIDER'] }
  },
  IN_PROGRESS: {
    raiseQuoteRevision: { to: 'QUOTE_REVISION', allowedRoles: ['PROVIDER'] },
    complete: { to: 'WORK_COMPLETED', allowedRoles: ['PROVIDER'] }
  },
  QUOTE_REVISION: {
    approveQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] },
    rejectQuoteRevision: { to: 'IN_PROGRESS', allowedRoles: ['CUSTOMER'] }
  }
  // every other status is terminal for this spec's scope: no outgoing transitions defined
};

export const canTransition = (from: BookingStatus, event: BookingEvent, actorRole: ActorRole): BookingTransition | null => {
  const transition = BOOKING_TRANSITIONS[from]?.[event];
  if (transition === undefined || !transition.allowedRoles.includes(actorRole)) return null;
  return transition;
};
```

`cancel`'s `to` value in the table above is a placeholder only used for the "is this event legal
from this state" check; the service always overrides it with `CANCELLED_CUSTOMER` or
`CANCELLED_PROVIDER` based on `actor.role` before writing the status, since the table's job is "is
this event legal from this state for this role," not "compute the exact target."

Unit tests here (in `packages/domain/test/`) cover every legal transition and a representative
sample of illegal ones (wrong state, wrong role) — pure functions, no DB, fast.

## 5. `BookingStateService` — `apps/api/src/booking/booking-state.service.ts`

The single place allowed to write `bookings.status`, matching the convention your own progress
tracker already named for this ticket (`SHM-034`) and the lint rule intended to enforce it (noted
in the tracker as not currently firing — worth fixing separately, not blocking this spec).

```ts
async apply(bookingId: string, event: BookingEvent, actor: AuthenticatedPrincipal, opts: { reason?: string; metadata?: object } = {}): Promise<BookingRow>
```

Inside a transaction: `SELECT ... FOR UPDATE` the booking row (serializes concurrent actions on
the same booking — e.g. simultaneous cancel + accept), resolve `canTransition`, run the
event-specific guard/side-effect (below), `UPDATE bookings SET status = $to`, `INSERT INTO
booking_status_history`. Any domain error inside the transaction rolls the whole thing back.

Per-event side effects:

| Event | Side effect before the status write |
|---|---|
| `accept` | none beyond the transition itself |
| `decline` | requires a `reason` |
| `cancel` | customer-initiated: computes `insideFourHourWindow = scheduled_start - now() < 4h` and records it in `metadata` (the actual fee charge needs M8 — this just records whether one *would* apply); provider-initiated: no fee logic, just records the cancellation (SRS §5.3: three provider cancellations in 30 days should trigger review — needs M15, not built, so only recorded, not enforced). Either way sets `cancel_reason` |
| `reschedule` | requires `reschedule_count = 0` (DB column already exists), re-validates the new time against availability/time-off, requires >4h before the **current** `scheduled_start`, increments `reschedule_count`, updates `scheduled_start`/`scheduled_end`/`slot` (exclusion constraint re-checks automatically) |
| `depart` | generates the start OTP (see §7), delivers via the existing mock SMS sender |
| `start` | verifies the OTP against `start_otp_hash` (rate-limited via `start_otp_attempts`/`start_otp_locked_until`, same shape as identity's OTP lockout), sets `start_otp_verified_at`, `checkin_at` |
| `raiseQuoteRevision` | creates the `quote_revisions` row (`PENDING`), does not touch `booking_items` yet |
| `approveQuoteRevision` | inserts the `booking_items` row(s) for the revision (`kind = EXTRA`, `revision_id` set), bumps `approved_total_paisa` by `delta_paisa`, marks revision `APPROVED` |
| `rejectQuoteRevision` | marks revision `REJECTED`, no `booking_items`/`approved_total_paisa` change |
| `complete` | requires every `service_checklist_items` row for `booking.service_id` to have a matching `job_checklist_results` row with `done = true`; creates the `invoices` row (`subtotal_paisa` = sum of `booking_items.amount_paisa`, `total_paisa` = subtotal − discount, `final_amount_paisa` set to the same, `completed_at` set) |
| `noShow` | requires the caller to say who didn't show (`no_show_party`); customer no-show and provider no-show both land on `NO_SHOW` — SRS's "provider no-show refunds in full and penalises the provider" can't be enforced without M8/M15, so this spec just records which party |

## 6. Endpoint surface — `apps/api/src/booking/booking.controller.ts`

All under `Controller('bookings')`, `ApiBearerAuth`. `parseWith` + Zod schemas, same as every
other module.

| Method | Path | Role | Body |
|---|---|---|---|
| POST | `/bookings` | CUSTOMER | `{ providerId, serviceId, addressId, scheduledStart, scheduledEnd, problemText? }` |
| GET | `/bookings/:id` | owner (customer or the assigned provider) | — |
| GET | `/bookings` | CUSTOMER or PROVIDER | `?status=` — lists the caller's own bookings |
| POST | `/bookings/:id/accept` | PROVIDER | — |
| POST | `/bookings/:id/decline` | PROVIDER | `{ reason }` |
| POST | `/bookings/:id/cancel` | CUSTOMER or PROVIDER | `{ reason? }` |
| POST | `/bookings/:id/reschedule` | CUSTOMER | `{ scheduledStart, scheduledEnd }` |
| POST | `/bookings/:id/depart` | PROVIDER | — |
| POST | `/bookings/:id/start` | PROVIDER | `{ code }` |
| POST | `/bookings/:id/checklist/:itemId` | PROVIDER | `{ done: true }` |
| POST | `/bookings/:id/quote-revisions` | PROVIDER | `{ reason, deltaPaisa, items: [{description, quantity, unitPricePaisa}] }` |
| POST | `/bookings/:id/quote-revisions/:revisionId/approve` | CUSTOMER | — |
| POST | `/bookings/:id/quote-revisions/:revisionId/reject` | CUSTOMER | — |
| POST | `/bookings/:id/complete` | PROVIDER | — |

`POST /bookings` validation chain (all pre-existing data from M1–M4, no new lookups invented):
service is active; provider is `APPROVED` with an `APPROVED` `provider_services` row for that
service; address belongs to the calling customer and isn't archived; `scheduledEnd > scheduledStart`;
the requested window falls inside a `provider_availability` block for that weekday and doesn't
intersect `provider_time_off`. `quoted_amount_paisa` and `approved_total_paisa` both start equal
to the provider's `provider_services.price_paisa`. On the DB's exclusion-constraint violation
(`23P01`), respond `409 CONFLICT` ("that provider is no longer free at this time") rather than
leaking the Postgres error.

## 7. Start OTP

Reuses `generateOtpCode()` from `identity/otp.ts` (already generic — no purpose parameter) but
**not** `hashOtpCode`, since that's typed to the identity module's `OtpPurpose` enum
(`REGISTER`/`LOGIN`/`PASSWORD_RESET`/`PHONE_CHANGE`) and booking OTPs aren't stored in the shared
`otp_tokens` table at all — they live directly on `bookings.start_otp_hash`. A small local
`hashBookingOtp(pepper, bookingId, code)` in the booking module, keyed on the same `OTP_PEPPER`
secret for consistency, keeps this isolated rather than widening a shared enum for one caller.
Delivered via the same mock SMS sender integration (`SMS_SENDER` port) everything else uses,
landing in `GET /dev/inbox` exactly like every other OTP in this codebase.

## 8. Quote revisions

`raiseQuoteRevision` takes a reason and a list of extra line items with their own quantity/price —
`deltaPaisa` is the server-computed sum of those items, not trusted from the client, even though
the endpoint accepts a `deltaPaisa` field for display/logging; the authoritative amount is always
recomputed from the items server-side before being written anywhere financial.

## 9. Checklist, evidence and completion

`POST /bookings/:id/checklist/:itemId` inserts/updates a `job_checklist_results` row
(`visit_no = 1` — always 1 in this spec's scope; it only increments on rework, which is M7).
`complete` checks every active `service_checklist_items` row for the booking's service has a
`done = true` result before allowing `WORK_COMPLETED`. No `job_evidence` row, no photo, no
`requiresPhoto` enforcement — noted in §2 as a deliberate, confirmed cut, not an oversight.

## 10. Error handling

Same vocabulary as every other module: `notFound`, `conflict`, `badRequest`, `forbidden` from
`common/domain-error.ts`. New cases specific to this module:
- Wrong actor on someone else's booking → `404` (not `403` — same "don't leak existence" pattern
  used for customer addresses in M2), except role-mismatch on an *owned* booking (e.g. a customer
  calling `/accept`) → `403 FORBIDDEN`, since existence isn't in question there.
- Illegal transition (e.g. `/accept` on an already-`SCHEDULED` booking) → `409 CONFLICT` naming
  the current status.
- Double-booking race (`23P01`) → `409 CONFLICT`.
- Start OTP wrong/exhausted → `422`/`401` mirroring identity's own OTP lockout shape exactly.

## 11. Testing

TDD against real Postgres, same as every prior module. New pieces this spec needs that didn't
exist before: a `readyBookableProvider()` test helper in `harness.ts` (register provider → fill
profile → offer a service → admin-approve both, i.e. exactly the `readyProvider()` helper already
written for `search.test.ts` — reused, not reinvented) plus a `bookAndSchedule()` helper once
enough of the flow exists, so later tests in the file don't re-walk the whole state machine by
hand. Pure state-machine unit tests live in `packages/domain/test/`.

## 12. File layout

```
packages/domain/src/bookingTransitions.ts       (+ test)
apps/api/src/booking/
  booking.schemas.ts
  booking-state.service.ts
  booking.service.ts        (queries: create, get, list — the non-state-machine half)
  booking.controller.ts
  booking.module.ts
  start-otp.ts               (generate/hash/verify, local to this module)
apps/api/test/integration/booking.test.ts
```

## 13. Open questions for the implementation plan, not this design

None blocking — the one real open question (evidence upload) was resolved in §2/§9. The
`BookingStateService.apply()` lint rule not currently firing is a pre-existing gap noted in the
progress tracker, worth a look while this module is being built (it's meant to guard exactly this
module) but is a separate, small fix, not part of this design.
