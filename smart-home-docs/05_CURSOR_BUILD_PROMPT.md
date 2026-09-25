# Cursor Build Prompt — Smart Home Maintenance Services

This file drives an AI coding agent (Cursor Agent mode) to build the system phase by phase from the specifications. It is written so each phase ends in a working, demonstrable, tested increment and the agent cannot drift from the specs.

## How to use

1. Create an empty repo `smart-home/`. Copy the documents into `docs/`:
   `docs/01_SRS_v2.1.md`, `docs/02_TRD.md`, `docs/03_ERD.md`, `docs/04_schema.sql`, `docs/05_CURSOR_BUILD_PROMPT.md`.
2. Copy `06_cursor_rules/*.mdc` into `.cursor/rules/` (these are always-on project rules).
3. Open Cursor → Agent mode → model with the largest context available → paste **Prompt 0 (Master Context)**. Wait for the agent's plan and confirm it.
4. Paste **one phase prompt at a time**. Do not start the next phase until the phase's *Exit checks* all pass and you have committed (`git tag phase-N`).
5. After every phase paste the **Review Prompt** (end of this file). Fix what it finds before moving on.
6. If the agent proposes to deviate from a spec, it must say so explicitly and update the spec in the same PR; reject silent deviations.

---

## Prompt 0 — Master Context (paste first, once)

```
You are the senior full-stack engineer who owns this product end to end. You are building
"Smart Home Maintenance Services": a home-repair marketplace where payment is released only
after the platform verifies the completed work with the customer (telephone call or one-tap link).

READ FIRST, fully, before writing any code:
  - docs/01_SRS_v2.1.md   (WHAT: requirements, states T1–T26, clarifications CL-xx, config BR-xx)
  - docs/02_TRD.md        (HOW: architecture, stack, module map, ledger, verification engine, API)
  - docs/03_ERD.md        (data model explained)
  - docs/04_schema.sql    (THE database schema — source of truth; do not redesign it)

Precedence when documents disagree: SRS > schema.sql > TRD > your own judgement.
If you find a genuine contradiction, STOP and tell me; propose a fix to the doc.

Non-negotiable engineering rules:
 1. Stack exactly as TRD §2: pnpm + Turborepo; apps/web = Next.js 15 App Router + TS + Tailwind + shadcn/ui
    + next-intl (en, ur RTL) + TanStack Query + react-hook-form + zod; apps/api = NestJS 11 (Fastify)
    with two entrypoints (main.ts HTTP/WS, worker.ts BullMQ); PostgreSQL 16 + PostGIS; Redis 7 + BullMQ;
    S3-compatible storage (MinIO locally); Prisma as CLIENT ONLY (prisma db pull), migrations with dbmate
    (plain SQL). NEVER run `prisma migrate`.
 2. Repository layout exactly as TRD §3. Pure business logic lives in packages/domain with ZERO I/O
    imports (no Nest, no Prisma, no fetch, no Date.now — inject a Clock).
 3. Shared zod schemas/enums/error codes live in packages/contracts and are used by both web and api.
 4. bookings.status changes ONLY through BookingStateService.apply() which runs inside a transaction,
    SELECT … FOR UPDATE, uses domain.nextState(), writes booking_status_history, sets
    `SET LOCAL app.transition_ctx = 'on'`, and writes an outbox event. No other code may set status.
 5. Money: BIGINT paisa everywhere; only LedgerService.post() writes ledger rows; every posting balanced;
    postings follow TRD §6.3 recipes exactly. No floats for money, ever.
 6. Side effects on external systems (SMS, email, gateway refunds, telephony) run from the outbox in the
    worker, never inside a DB transaction and never directly from a controller.
 7. Every external dependency behind a port interface with a fully working MOCK adapter (TRD §17);
    the whole system must run offline with `docker compose up` + `pnpm dev`.
 8. Every route declares an authorisation policy (TRD §16). Server-side enforcement only counts.
 9. Every configurable value comes from the settings table (SRS §13), cached, never hard-coded.
10. Every privileged action writes audit_log. Every mutation that moves money or state accepts
    an Idempotency-Key.
11. Tests are part of the task, not a follow-up: unit tests for domain, integration tests with
    Testcontainers for DB-level guarantees, Playwright for the phase's E2E journey (TRD §20).
12. UI: mobile-first at 360 px, English + Urdu (RTL via logical Tailwind classes), accessible
    (labels, focus rings, text errors). Provider screens must work on slow 3G.
13. Security: Argon2id, JWT access 15 min + rotating refresh cookie, TOTP for staff, rate limits on
    auth/OTP, CSRF protection, zod validation on every input, output DTO whitelisting, PII redaction in logs.
14. Small, reviewable commits with conventional messages. Keep a CHANGELOG.md per phase.

Working method for every phase I give you:
  a) Restate the phase goal and list the SRS requirement IDs and TRD sections you will implement.
  b) Show a short plan (files to create/modify). Wait for my "go" only if I ask you to; otherwise proceed.
  c) Implement in vertical slices (DB → domain → service → API → UI → tests).
  d) Run lint, typecheck, unit, integration and E2E tests; fix until green.
  e) Finish with: what was built, requirement IDs covered, tests added, known gaps, and the exact
     commands I run to verify.

Do not implement anything from a later phase unless it is needed as a stub. Stubs must throw
`NotImplementedException('<Phase N>')`.

Reply now with: (1) your understanding of the system in ≤ 15 bullet points, (2) the three core
invariants you consider most dangerous to get wrong, (3) any contradictions you found in the docs.
Do not write code yet.
```

---

## Prompt 1 — Phase 0: Foundation & Infrastructure

```
PHASE 0 — Foundation. Goal: a monorepo that builds, migrates, seeds, authenticates every role and runs CI.

Implement:
1. Monorepo per TRD §3 (pnpm workspaces, Turborepo pipelines: lint, typecheck, test, build, dev).
   Shared tsconfig/eslint/prettier in packages/config. ESLint rules: no floating promises,
   no `any`, ban `Number(` on money types, ban direct `status:` writes on booking outside
   BookingStateService (custom rule or restricted-syntax).
2. infra/docker-compose.yml: postgis/postgis:16-3.4, redis:7, minio (+ bucket bootstrap for
   `evidence`, `documents`, `recordings`, `reports`), mailpit.
3. packages/db: copy docs/04_schema.sql to migrations/0001_init.sql (dbmate format), scripts
   `db:migrate`, `db:pull` (prisma db pull + generate), `db:reset`, `db:seed`.
   Seed (deterministic, TRD §20): Lahore + 20 areas; 6 active + 2 inactive categories; every service
   from SRS v2.0 §3.1 with sensible PKR prices, durations, pricing models (CL-01), checklists
   (3–6 items, some requiring photos); roles & permissions; staff users (admin, finance, 2 agents)
   with known dev passwords printed on seed; all SRS §13 settings with defaults; breach_types from
   SRS §8.2; notification templates (en + ur) for every event in SRS FR-NT-02..04; global commission 15 %.
4. packages/contracts: enums mirrored from schema, error code catalogue, Money type, pagination,
   problem+json schema.
5. packages/domain: Clock interface + FakeClock; Money helpers (add, sub, pct with half-up rounding
   in basis points); SlaCalendar (calling hours 08:00–22:00 Asia/Karachi, addBusinessMinutes) with tests
   for 21:50, 22:00, 07:59, midnight, multi-day.
6. apps/api: NestJS on Fastify; config module validating env with zod (fail fast); Prisma service;
   Redis; BullMQ module with queue registry; outbox table poller + dispatcher skeleton; global
   exception filter emitting problem+json; request-id + pino logger with PII redaction; health endpoints;
   OpenAPI at /api/docs; settings service (DB + Redis cache + pub/sub invalidation); audit service;
   idempotency interceptor (TRD §5.4).
7. Identity module: register (customer/provider) with phone OTP, login, refresh rotation with reuse
   detection, logout, forgot/reset password, staff TOTP setup/verify (mandatory for staff roles),
   rate limiting, policy guard + @Policy() decorator + test that fails if any route lacks a policy.
8. Integration adapters (ports + mocks) for payment, sms, email, maps, telephony, whatsapp, storage.
   Mock SMS/email write to a dev inbox visible at web route /dev/inbox (dev only).
9. apps/web: Next.js with next-intl (en/ur, RTL), Tailwind + shadcn/ui, auth pages (register customer,
   register provider, login, OTP, forgot/reset, staff TOTP), role-based layout shells for /c, /p, /agent,
   /finance, /admin with empty dashboards; API client with refresh handling; PWA manifest for /p.
10. CI (GitHub Actions): install → lint → typecheck → unit → integration (service containers) → build.

Exit checks (all must pass):
- `docker compose up -d && pnpm db:reset && pnpm dev` → I can register a customer via OTP from /dev/inbox,
  log in as each staff role with TOTP, and see the right shell.
- Integration tests prove: insert-only triggers on audit_log/ledger_entries; bookings status trigger
  rejects a raw UPDATE; users DELETE rejected; ledger unbalanced transaction rejected at commit.
- Route-policy test passes. CI green.
```

---

## Prompt 2 — Phase 1: Onboarding (M1, M2, M3, M12 core)

```
PHASE 1 — Onboarding. Goal: an administrator can onboard a real tradesman who then becomes bookable-ready.

Requirements: FR-CAT-01..08, FR-CU-01..09, FR-SP-01..08, FR-SP-14 (read-only shell), FR-AD-01..10,
FR-AD-13..16, FR-PN-08, NFR-PR-03. TRD §4 (catalogue, places, customers, providers, admin), §10 uploads, §18.

Build:
1. Catalogue admin CRUD (categories, services, checklist items, commission rules) with all schema CHECKs
   surfaced as friendly validation errors. Public catalogue pages (/, /services/[category], /[service]) SSR.
2. Customer: profile, change password (revokes other sessions), addresses with map pin (mock geocoder +
   Leaflet map picker), area validation, default address, favourites, deactivate (anonymiser).
3. Provider onboarding wizard (mobile-first, Urdu-ready): profile → photo → services & prices within band
   → service areas + base location + radius → weekly availability + time off → documents (CNIC front/back,
   trade cert, optional character cert) via presigned upload → payout account → read & accept penalty
   schedule (FR-PN-08, stored timestamp) → submit for approval.
   CNIC number encrypted (AES-256-GCM) with HMAC blind index; duplicate CNIC rejected.
4. Admin: approval queue, provider detail with document viewer (signed URLs 5 min, access audited,
   only approving admin role), verify/reject documents, approve/reject provider with reason (notify),
   approve provider_services, block/unblock/deactivate, customer management, send password-reset link
   (admin never sees passwords), role management, staff conflicts, settings editor (typed per key, audited).
5. On approval: create provider_stats row and PROVIDER_WALLET ledger account.
6. Slot generator in packages/domain (TRD §7) + GET /providers/:id/slots, with unit tests for leave,
   travel buffer, day boundaries and DST-free PKT.

Tests: unit (slot generator, commission resolution), integration (approval blocked without VERIFIED CNIC;
price outside band 422; time-off overlap rejected by DB), E2E: "provider registers → admin approves →
provider appears as APPROVED with services" at 360 px and in Urdu.

Exit checks: E2E green; admin actions appear in audit_log; ID documents inaccessible to agent/finance roles (403).
```

---

## Prompt 3 — Phase 2: Transacting (M4, M5, M6)

```
PHASE 2 — Transacting. Goal: a job runs end to end from search to AWAITING_VERIFICATION, cash and online.

Requirements: FR-SR-01..07, FR-BK-01..10, FR-EX-01..12, FR-PY-01/02 (capture only), FR-PY-12, FR-SP-09,
FR-NT-02/03 (via outbox; delivery to mock adapters). SRS §6 transitions T1–T17. TRD §5, §6.5, §7, §8, §10.

Build:
1. packages/domain/bookingMachine.ts implementing SRS §6.2 T1–T26 as data (all rules, even those
   used in later phases) + guards; generated test matrix asserting every legal transition and rejecting
   every other (status × event) pair; fast-check property test on random event sequences.
2. BookingStateService.apply() exactly as TRD §5.2 including chained transitions and outbox.
3. Search: service-first flow, PostGIS candidate query (TRD §8), ranking in domain with configurable
   weights and Bayesian prior; filters FR-SR-01/05; distance shown; blocked/suspended/debt-blocked excluded.
   Seed 10 000 providers via a separate `seed:load` script and verify p95 < 800 ms locally.
4. Checkout: quote endpoint (price, visit fee, emergency surcharge, coupon, outstanding receivable,
   cancellation policy — FR-BK-04), cash → REQUESTED; online → PENDING_PAYMENT → mock gateway page →
   signed webhook → capture posting (D GATEWAY_CLEARING / C ESCROW) + payment_captured, all idempotent;
   payments.timeout job → ABANDONED. Slot conflict → 409 SLOT_TAKEN (exclusion constraint 23P01) and UI refresh.
5. Offers: direct booking and auto-assign cascade (booking_offers, delayed expiry jobs, re-offer,
   UNFULFILLED + refund posting); realtime countdown for provider via Socket.IO.
6. Customer cancel (fee rules; online fee from escrow; cash fee → CUSTOMER_RECEIVABLE), reschedule once,
   provider cancel (refund, flag), no-show (after grace), masked chat.
7. Execution (provider PWA): depart → start with OTP (hashed, attempts, lock) + geolocation check-in →
   before photos → checklist with required photos → revised quote (customer approves in app; online
   requires top-up payment captured before T15) → parts/extras lines → after photos → complete
   (guards: OTP, checklist, after photo, final ≤ approved_total) → invoice + PDF job → chained
   AWAITING_VERIFICATION with a verification_calls row (tier routing may be a stub returning Tier A,
   reason FORCE_TIER_A, until Phase 3).
8. Offline evidence queue: IndexedDB + service worker background sync, client_uuid dedupe (FR-EX-12).
9. Customer booking detail page with live status timeline (booking_status_history), OTP card, revision
   approval, chat, invoice.

Tests: domain matrix + property tests; integration: 50 concurrent checkouts for one slot → exactly 1 succeeds;
webhook replay ×10 → one capture; final > approved_total → 422. E2E: (a) cash job to AWAITING_VERIFICATION,
(b) online inspection-first job with approved revision + top-up, (c) auto-assign with first provider
declining.

Exit checks: all green; every transition produced a history row; no status write outside the service (lint).
```

---

## Prompt 4 — Phase 3: Verification & Money (M7, M8, M9)

```
PHASE 3 — Verification and money. Goal: money moves correctly, and ratings exist only from verification.

Requirements: FR-VC-01..15, FR-PY-01..13, FR-RT-01..07, FR-SP-04/05/10..13, FR-CU-06, SRS §5 fully,
T18–T26, CL-02/03/04/08/09/10/11/17/19/20/22/24. TRD §6, §9, §13.

Build:
1. domain.routeTier() rules R1–R10 with injected rng; unit test per rule; BR-25 force flag honoured.
2. Queue: priority (cash first) + SLA via SlaCalendar; claim with SELECT … FOR UPDATE SKIP LOCKED;
   lock sweeper; 423 outside calling hours; conflict-of-interest check (phone/email/CNIC/staff_conflicts).
3. Agent console (single screen, TRD §15): booking + invoice + photo gallery (before/after side by side)
   + provider history + open complaints + questionnaire with keyboard shortcuts; consent checkbox gates
   the form; click-to-call via telephony adapter (mock: simulate answered/no-answer) and manual-dial mode;
   attempt logging with time bands; outcome guard rules (extra charge = YES or work = NONE → only DISPUTED).
4. Submission transaction (TRD §9.4): immutable record, booking event, release posting with commission
   and coupon handling and excess-escrow refund (TRD §6.3), rating + remark (display name "First L."),
   VERIFIED_WITH_ISSUE → complaint + flag. Rework: REWORK_REQUIRED, 48 h delayed job, new visit requires new
   OTP, second failure → DISPUTED (dispute row created; resolution UI is Phase 4).
5. Unreachable flow: 3 attempts across ≥ 2 bands → verification link (SMS + WhatsApp mock) → public page
   /v/[token] with OTP + short questionnaire → LINK_CONFIRMED; 72 h auto-release sweep (rating suppressed);
   Tier B escalation after 24 h.
6. Cash settlement (UC-18): provider "Payment received" → cash commission posting → PAYMENT_RELEASED →
   customer SMS receipt with problem link (creates complaint source RECEIPT_LINK). Debt ceiling →
   offer_blocked_reason = 'DEBT'; provider debt payment online (FR-PY-13).
7. Finance console: escrow held, releases, refunds (gateway refund via outbox + ledger), payout requests,
   weekly payout batch job producing CSV + per-provider PDF statements, mark paid/failed, cash reconciliation,
   debts list, ledger explorer by account. Nightly reconciliation job (drift alert).
8. Reputation projector: provider_stats (CL-17 weighted score, distribution, counts), badges from verified
   jobs only, low-rating flag (CL-18). Provider earnings dashboard reading ledger-derived values; ratings &
   remarks pages; one immutable reply per remark; admin unpublish (rating stays, audited).
9. Recording retention purge job; recordings playable only by finance/admin (signed URLs, audited).

Tests: tier rules; SLA edge cases; integration: rating insert without verification rejected by DB;
UPDATE on submitted verification rejected; release blocked by trigger without verification; concurrent
claim by two agents → one lock; ledger sums zero across a full job; commission rounding.
E2E: online happy path to PAYMENT_RELEASED with rating visible on profile; cash path with collection;
unreachable → link confirm; unreachable → auto-release with no rating; rework → second failure → DISPUTED.

Exit checks: all green; reconciliation job reports zero drift on seeded + E2E data.
```

---

## Prompt 5 — Phase 4: Trust & Communication (M10, M11, M15)

```
PHASE 4 — Trust and communication. Goal: complaints, disputes, penalties and appeals work end to end,
with notifications on every state change.

Requirements: FR-CP-01..08, FR-NT-01..06, FR-PN-01..10, FR-AD-11, SRS §8, CL-14/15/16/18/21, UC-13/14/15.
TRD §11, §12.

Build:
1. Complaints: customer and provider forms with photos; states + SLA by severity (BR-56); safety complaints
   top of queue with immediate admin alert; timeline (complaint_events); assignment; visible in agent console.
2. Disputes: admin queue with evidence floor viewer (OTP time, geofence distances, photos, checklist,
   invoice, verification record, call recording for authorised roles); 48 h provider reply; resolution
   (full release / partial / full refund / refund + penalty) posting ledger entries in one transaction
   (T24) and notifying both parties.
3. Conduct engine: penalty PROPOSED → provider reply (48 h) → admin APPLY (DB check enforces timing) →
   demerit award (expiry 180 d) + fine capped per job (FR-PN-05) + wallet debit/debt; threshold evaluator
   in domain with harsher-wins merge (CL-14) and once-per-crossing (CL-16); suspensions/blocks applied;
   appeals with reversal (void award, compensating ledger reversal). Daily job: expiry, decay (CL-15),
   lift suspensions, flags. Provider conduct page with decay progress (FR-SP-14).
4. Automatic breach proposals: no-show, late cancel, rework verified, poor rating streak, overcharge
   (from verification answer), falsified (dispute resolution) — always PROPOSED, never auto-applied.
5. Notifications: planner matrix (event × role → channels) for every booking transition and M7/M8/M10/M15
   event; template renderer (en/ur); retries/backoff; delivery receipts webhook; in-app notification centre
   with unread badge via Socket.IO; admin template editor with preview.

Tests: domain time-travel tests for decay/expiry/thresholds; integration: penalty apply before deadline
without reply rejected by DB; appeal reversal restores wallet and points; notification idempotency per outbox
event. E2E: dispute → partial refund → penalty proposed → provider replies → applied → appeal → reversed.

Exit checks: all green; every booking transition in an E2E run produced the expected notifications.
```

---

## Prompt 6 — Phase 5: Depth, Hardening & Release (M13, M14, ops)

```
PHASE 5 — Depth and release. Goal: plans, reports, operations board, performance and security hardening.

Requirements: FR-MP-01..04, FR-RP-01..06, FR-AD-12, all NFRs (SRS §12). TRD §19–§22.

Build:
1. Plans: admin CRUD; subscribe (PLAN_DEFERRED posting); daily scheduler creating plan visit bookings
   7 days ahead offered first to the preferred provider; plan visits follow the same verification flow with
   PLAN_RELEASE posting; cancellation with pro-rata refund of unused visits.
2. Reports (async, report_runs): monthly bookings & successful handling (FR-RP-02 definition), revenue by
   month/category (ties to ledger), provider performance, verification report; PDF (pdfmake) + XLSX (exceljs);
   printable HTML view.
3. Operations board (realtime): today's bookings by state, queue depth, SLA breaches, open disputes, total
   escrow held, debt-blocked providers.
4. Hardening: k6 scripts (search 50 rps p95 < 800 ms; queue claim), indexes verified with EXPLAIN,
   OWASP ZAP baseline in CI, CSP with nonces, Sentry, Prometheus metrics & alerts (TRD §19), runbooks,
   backup/restore script and documented drill, accessibility audit (axe) on key pages, full Urdu pass.
5. Deployment: production Dockerfiles (multi-stage, non-root), compose/prod or platform manifests,
   GitHub Actions deploy to staging on tag, manual approval to prod, migrations as release step.

Exit checks: all NFR measures in SRS §12 demonstrated with evidence (screenshots/k6 output/ZAP report);
UAT script (docs/UAT.md, generate it from SRS use cases) executed end to end.
```

---

## Review Prompt (run after every phase)

```
Act as a strict reviewer. Audit the code produced in this phase against docs/01_SRS_v2.1.md,
docs/02_TRD.md and docs/04_schema.sql. Produce a table: requirement ID | implemented? | test that proves it |
gap. Then check specifically:
- any write to bookings.status outside BookingStateService?
- any money math using number/float, or ledger rows written outside LedgerService?
- any external call inside a DB transaction?
- any route without a policy, any response DTO leaking phone/CNIC/full name to the wrong role?
- any hard-coded value that belongs in settings (SRS §13)?
- any missing audit_log entry for a privileged action?
- any missing Idempotency-Key handling on money/state mutations?
- Urdu/RTL and 360 px issues on screens added this phase?
List concrete fixes with file paths; then apply them and re-run all tests.
```

## Bug-fix Prompt (when a test or scenario fails)

```
Reproduce the failure with a failing automated test first (unit if the bug is in packages/domain,
integration otherwise). Explain the root cause in two sentences referencing the SRS/TRD rule violated.
Fix with the smallest change, keep the test, run the full suite, and summarise.
```
