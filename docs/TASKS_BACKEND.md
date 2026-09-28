# Backend Task Board — Smart Home Maintenance Services

Reference docs: `TRD_Smart_Home_Maintenance.md` (architecture), `ERD_Smart_Home_Maintenance.md`
+ `schema.prisma` (data model). Every task below cites the SRS requirement ID it satisfies
so a reviewer can trace a PR straight back to Section 6 of the SRS.

**How to use this file:** check items off as PRs merge; don't reorder phases — each phase's
"Definition of done" is the gate for starting the next. Group commits/PRs by module, not by
individual checkbox, so review stays reviewable.

---

## Phase 1 — Foundation
`identity` · `catalogue` · `admin` (approval slice) · infra

### Infra & scaffolding
- [ ] npm workspaces monorepo: `apps/api`, `apps/worker`, `packages/prisma`, `packages/contracts`, `packages/integrations`
- [ ] `packages/prisma`: add `schema.prisma`, run first migration, wire generated client as a workspace dependency
- [ ] `docker-compose.yml`: `postgres`, `redis`
- [ ] `apps/api` bootstrap: NestJS + `@nestjs/platform-express`, global `ValidationPipe`, `helmet`, `@nestjs/swagger`
- [ ] CI pipeline: lint, typecheck, `prisma migrate diff` (fail on drift), unit tests
- [ ] `Setting` table + cached `ConfigService` wrapper (NFR-MA-01) — seed the config keys every later phase will need: `AUTO_RELEASE_WINDOW_HOURS`, `CALLING_HOURS_START/END`, `VERIFICATION_TIER_A_SAMPLE_RATE`, etc.

### Identity module (M2, M3, M12-auth)
- [ ] FR-CU-01 / FR-SP-01 — registration + login, JWT access + refresh tokens
- [ ] FR-CU-03 — mobile OTP verification at registration (this number is the one verification calls go to — get it right here)
- [ ] FR-CU-04 — password recovery via email or SMS one-time code
- [ ] FR-CU-02 / FR-SP-03 — profile view/update, password change
- [ ] FR-SP-02 — provider profile: experience, expertise, qualification, picture, location
- [ ] FR-SP-06 — CNIC / trade certificate / optional character certificate upload; approval blocked until verified
- [ ] FR-AD-10 — approval workflow: reviewer, decision, reason recorded; rejection notifies provider with explanation
- [ ] NFR-SE-01 — Argon2id password hashing
- [ ] NFR-SE-06 — rate limiting on `/auth/*`, `/otp/*` (`@nestjs/throttler`)
- [ ] `RolesGuard` + `@Roles()` decorator for the 5-role enum, applied globally

### Catalogue module (M1)
- [ ] FR-CAT-01 — admin CRUD on categories and services
- [ ] FR-CAT-02 — service fields: description, price/price band, duration, pricing model (flat / per-day / inspection-first)
- [ ] FR-CAT-03 — provider expertise selections bound to catalogue services (a provider is only offered jobs for approved services)
- [ ] FR-CAT-04 — provider custom price, validated against the admin's band
- [ ] FR-CAT-05 — commission rule at global / category / provider scope
- [ ] FR-CAT-06 / FR-CAT-07 — emergency-eligible, plan-eligible, warranty-eligible, high-risk flags
- [ ] Seed script: the 6 launch categories + full service list (SRS §3.1), plus the 2 held-back categories flagged inactive

### Admin module — approval & user management slice (M12)
- [ ] FR-AD-01 — admin login (reuses Identity)
- [ ] FR-AD-02 — approve registered providers
- [ ] FR-AD-03 / FR-AD-05 / FR-AD-09 — manage providers & customers; delete = soft deactivation only, never physical
- [ ] FR-AD-13 — role/permission scaffolding for agent, finance, admin logins
- [ ] FR-AD-14 — append-only audit log: DB role has no `UPDATE`/`DELETE` grant on `audit_log`, plus a service-layer `AuditService.record()` called from every privileged action

**Definition of done — Phase 1:** an admin can onboard a real tradesman end to end —
register → verify phone → upload documents → admin reviews and approves → provider adds
services and prices within the admin's band.

---

## Phase 2 — Transacting
`search` · `booking` · `execution`

### Search & matching (M4)
- [ ] FR-SR-03 — service-first search: customer picks a service, sees providers offering it in their area
- [ ] FR-SR-04 — structured location (city/area/coordinates); distance shown on every result
- [ ] FR-SR-01 / FR-SR-02 — filter by location, experience, expertise, rating; full provider detail view
- [ ] FR-SR-05 — additional filters: price range, available today, verified-documents-only, min completed jobs
- [ ] FR-SR-06 — ranking: rating + distance + completion rate + response speed + recency, admin-configurable weights; blocked/unapproved providers excluded (raw-SQL scoring query — see TRD §6)
- [ ] FR-SR-07 — auto-assign: offer down the ranked list until accepted

### Booking & scheduling (M5)
- [ ] FR-BK-02 — only free calendar slots selectable; confirming locks the slot against double booking
- [ ] FR-BK-01 / FR-BK-04 — booking creation with estimated price, visit/inspection fee, cancellation policy shown before confirm
- [ ] FR-BK-03 — problem description + up to 5 photos
- [ ] Booking state machine (SRS §5): implement `REQUESTED → ACCEPTED → SCHEDULED → EN_ROUTE → IN_PROGRESS → …` with every named branch transition (§5.3) — no other way to mutate `Booking.status`
- [ ] FR-BK-08 — every transition writes `BookingStatusHistory` (actor, timestamp, reason)
- [ ] FR-BK-05 / FR-BK-06 — reschedule once free (≥4h out), cancellation fee rules
- [ ] Provider-side: FR-SP-07 (availability calendar + leave), FR-SP-08 (service area/radius), FR-SP-09 (accept/decline countdown, no-response forfeits)
- [ ] FR-BK-07 — in-app messaging with phone-number masking (NFR-PR-01)

### Work execution & evidence (M6)
- [ ] FR-EX-01 — provider marks en route, customer notified
- [ ] FR-EX-02 — start OTP gates `IN_PROGRESS`; **`WORK_COMPLETED` must be blocked in code unless `startOtpVerifiedAt` is set** (Integrity Rule 10.3-2)
- [ ] FR-EX-03 — before/after photo capture with timestamps
- [ ] FR-EX-09 — geofenced check-in/check-out; flag significant shortfall vs. expected duration (feeds Tier A routing)
- [ ] FR-EX-04 / FR-EX-06 — parts/materials logged, itemised invoice generated on completion
- [ ] FR-EX-05 — revised quote requires in-app customer approval before work continues
- [ ] FR-EX-08 — service-specific checklist (with photo evidence where required) must complete before submission
- [ ] FR-EX-07 — configurable workmanship warranty; a claim reopens the original booking as rework, not a new job

**Definition of done — Phase 2:** a job runs end to end from search through completion
submission and stops cleanly at `AWAITING_VERIFICATION` (Phase 3 picks it up from there).

---

## Phase 3 — Verification and money
`verification` · `payments` · `trust` (ratings only) · **first worker jobs**

### Verification & feedback (M7)
- [ ] FR-VC-01 — completion → `AWAITING_VERIFICATION`, all funds frozen
- [ ] FR-VC-11 — Tier A/B routing per SRS §4.3 rules; tier stored on the booking
- [ ] FR-VC-03 — agent console query: booking + invoice + photos + provider history, single call
- [ ] FR-VC-04 — fixed questionnaire only (SRS §4.5) — no free-text feedback path
- [ ] FR-VC-05 — one of 4 outcomes recorded: verified / verified-with-issue / rework / disputed
- [ ] FR-VC-08 — verification record immutable once `submittedAt` is set; amendments are new linked rows, never edits
- [ ] FR-VC-10 — an agent cannot verify a booking where they're linked as the customer or provider
- [ ] FR-VC-06 — call attempts logged individually (time, agent, duration, result)
- [ ] FR-VC-09 — call recording: consent line, encrypted at rest, admin/finance-only access (NFR-PR-02)
- [ ] **Worker job:** `verification-sla` — flag bookings past the 30-minute contact SLA (§4.4), visible on the ops board (built in Phase 1's admin slice / extended in Phase 4)
- [ ] **Worker job:** `tier-escalation` — FR-VC-12, Tier B → Tier A after 24h no response
- [ ] **Worker job:** `auto-release` — FR-VC-07, 72h no reachable customer → release payment, suppress rating

### Payments, escrow & payouts (M8)
- [ ] FR-PY-02 — online capture into platform escrow via gateway adapter (`packages/integrations`)
- [ ] FR-PY-03 — escrow releases only on a passing verification outcome or the auto-release rule — no other release path
- [ ] FR-PY-04 — cash path: reversed sequence (call before cash changes hands), commission debited to wallet
- [ ] FR-PY-05 — commission-debt ceiling blocks new job offers until cleared
- [ ] FR-PY-06 — double-entry `LedgerEntry` writes for every movement (capture/hold/release/commission/refund/penalty/payout); balances always `SUM()`, never a stored editable field
- [ ] FR-PY-07 — refunds to original method, linked reason
- [ ] FR-PY-09 — idempotent gateway callbacks, keyed on `Payment.gatewayRef` (Integrity Rule 10.3-4 depends on this holding)
- [ ] FR-PY-08 — payout batch run (build the endpoint now; the scheduled trigger is a Phase 5 worker job)

### Ratings (M9 — verification-gated slice only; complaints/remarks UI-facing bits land in Phase 4)
- [ ] FR-RT-03 — `Rating` can only be created from a completed `VerificationCall` — enforced by the schema FK, not just application logic
- [ ] FR-RT-04 — published score = average of the 4 criteria, weighted toward the most recent 20 jobs
- [ ] Rating publish happens exactly at `PAYMENT_RELEASED`, never before (§4.4)

**Definition of done — Phase 3:** money moves correctly — a completed job reaches a
verification outcome (by call or auto-release) and the ledger reflects the release, with
no path in the codebase that releases funds any other way.

---

## Phase 4 — Trust and communication
`trust` (complaints/disputes/penalties) · `notifications`

### Complaints & disputes (M10)
- [ ] FR-CP-01 / FR-CP-07 — customer and provider can raise complaints
- [ ] FR-CP-03 — 5-state lifecycle (open/under review/awaiting response/resolved/rejected) with severity-based SLA
- [ ] FR-CP-08 — safety-severity complaints jump to the top of the admin queue
- [ ] FR-CP-05 — provider gets a right of reply before any penalty
- [ ] FR-CP-06 — resolution outcomes: no action / warning / partial refund / full refund / provider penalty / suspension / block
- [ ] Dispute resolution (UC-14): full release / partial release / full refund / refund-with-penalty, ledger + notification on resolution

### Conduct & penalties (M15)
- [ ] FR-PN-01 — demerit points per the Section 7.2 schedule
- [ ] FR-PN-02 — rolling 180-day expiry, decay 1 point / 30 clean days (worker job, see below)
- [ ] FR-PN-03 — Section 7.3 thresholds trigger automatically (warning → ranking demotion → suspension → re-verification → permanent block)
- [ ] FR-PN-04 — penalty debited from wallet; shortfall becomes a blocking debt
- [ ] FR-PN-05 — total liability per job capped at job value + configured max fine
- [ ] FR-PN-06 — no penalty applies until 48h right-of-reply has passed
- [ ] FR-PN-07 — appeal path, decision logged to `audit_log`
- [ ] **Worker job:** `demerit-decay` — daily cron implementing FR-PN-02

### Notifications (M11)
- [ ] FR-NT-01/02/03/04 — every booking/provider/admin event enqueues a notification (email/SMS/in-app)
- [ ] FR-NT-05 — delivery logged (channel, recipient, template, status)
- [ ] **Worker job:** `notification-dispatch` — queue-driven, sends via the email/SMS adapters, updates `Notification.status`

**Definition of done — Phase 4:** a complaint or a dispute can be raised, resolved, and
(where applicable) produce a logged, appealable penalty — with every state change
notifying the right party.

---

## Phase 5 — Depth
`plans` · `reporting` · remaining worker jobs

### Maintenance plans (M13)
- [ ] FR-MP-01 — admin defines plans (e.g. quarterly plumbing inspection, 2 call-outs)
- [ ] FR-MP-02 — subscribed visits auto-scheduled, offered first to the same provider
- [ ] FR-MP-03 — plan visits follow the identical verification flow; release draws on the plan balance
- [ ] FR-MP-04 — customer view of remaining entitlements/renewal date; cancel path

### Reporting (M14)
- [ ] FR-RP-01/02 — monthly bookings report; "successful" = verified or auto-released without dispute
- [ ] FR-RP-03 — revenue report (gross, commission, refunds, penalties, net) by month/category
- [ ] FR-RP-04 — provider performance report
- [ ] FR-RP-05 — verification report (calls placed, first-attempt success, avg duration, outcome mix, SLA compliance, auto-release count)
- [ ] FR-RP-06 — PDF + Excel export
- [ ] Move report queries onto raw SQL / a read replica once they compete with transactional load (TRD §5, §6)

### Remaining worker job
- [ ] **Worker job:** `payout-batch` — FR-PY-08, fixed-cycle cron producing the batch file + per-provider statements

### Operations board (M12, completed here)
- [ ] FR-AD-11 — auto-flag providers below the configured rolling-average threshold
- [ ] FR-AD-12 — ops board: today's bookings by state, verification queue depth, SLA breaches, open disputes, total escrow held
- [ ] FR-AD-15 — settings coverage complete: commission, cancellation fees, SLA timers, calling hours, auto-release window, surcharges, tier thresholds, penalty values

**Definition of done — Phase 5:** the system reports on itself — every number in the
implementation plan's success criteria is queryable without a manual DB query.

---

## Cross-cutting (do continuously, not a phase)
- [ ] NFR-SE-02/03/04/05 — server-side authz, parameterized queries, CSRF/XSS protection, upload restrictions
- [ ] NFR-IN-01/02 — every money operation inside `prisma.$transaction`; idempotent callbacks
- [ ] NFR-PE-01/02 — indexes present for search/filter load; verify with `EXPLAIN` before Phase 2 sign-off
- [ ] Unit tests per service class; e2e coverage for the booking state machine and the verification→payment path (TRD §11)
- [ ] Keep `packages/contracts` (shared DTOs/enums) in sync with `apps/api` — this is what the frontend task board's API client is built against
