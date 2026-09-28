# Build Prompt — Smart Home Maintenance Services (for OpenCode)

OpenCode reads a file named `AGENTS.md` at your repo root automatically, every session.
This document has two parts:

1. **AGENTS.md content** — copy everything in the fenced block below into a file named
   `AGENTS.md` at the root of your (new or existing) repo, and commit it.
2. **Kickoff prompt** — paste this as your first message in an OpenCode session, in the
   `build` agent, once `AGENTS.md` and the reference docs are in the repo.

---

## Part 1 — save this as `AGENTS.md`

````markdown
# Smart Home Maintenance Services — Agent Instructions

## What this is
A three-sided web marketplace (customer / tradesman / platform staff) for home repair
services, where **payment is only released after a platform-run telephone verification
call to the customer** — not on the tradesman's word, and not on an in-app rating typed
while he's still in the room. That one rule is the reason the payment, evidence and
verification modules exist and cannot be simplified away.

## Reference docs (read these before writing code)
- `docs/SRS_Smart_Home_Maintenance_Services.pdf` — the full specification. Every FR-xx-nn
  and NFR-xx-nn ID cited anywhere in this repo traces back to this document.
- `docs/TRD_Smart_Home_Maintenance.md` — architecture: why a modular monolith + one
  worker app, not a full microservices split; the npm-workspaces layout; module ↔ SRS
  mapping; NFR → implementation table.
- `docs/ERD_Smart_Home_Maintenance.md` + `packages/prisma/schema.prisma` — the data
  model. `schema.prisma` is authoritative; the `.md` is the readable version.
- `docs/TASKS_BACKEND.md`, `docs/TASKS_FRONTEND.md` — the phase-by-phase task boards.
  **Work through these in order and check items off as you complete them** (edit the
  checkbox in the file itself as part of the same commit/PR that closes it).

## Stack — do not substitute
Node.js 20 · NestJS 10 on `@nestjs/platform-express` (not Fastify) · TypeScript strict ·
PostgreSQL · Prisma ORM (raw SQL only where TRD §6 says to) · npm workspaces monorepo ·
BullMQ + Redis for background jobs · Jest for tests.

## Repo layout
Follow the monorepo layout in TRD §3 exactly:
```
apps/api/src/modules/{identity,catalogue,search,booking,execution,verification,
                      payments,trust,notifications,admin,plans,reporting}/
apps/worker/src/processors/
packages/prisma/       # schema.prisma + generated client — shared by api and worker
packages/contracts/    # shared DTOs/enums — the frontend's API client is built against this
packages/integrations/ # payment gateway / SMS / email / maps adapters (ports & adapters)
```
Don't invent a different module boundary partway through — if a task doesn't fit an
existing module folder, say so before creating a new one.

## Non-negotiable domain rules
These are the rules that are easy to accidentally violate while moving fast. Treat a
diff that breaks one of these as a bug, even if the immediate feature "works":

1. **A `Rating` can only be created from a completed `VerificationCall`.** There is no
   direct in-app rating endpoint (FR-RT-03). This is enforced by a required, unique FK
   in the schema — don't add an application code path that bypasses it.
2. **Payment only releases from a passing verification outcome or the 72-hour
   auto-release rule** (FR-PY-03). No other code path may move a booking to
   `PAYMENT_RELEASED` or credit a provider's wallet balance.
3. **`Booking.status` only changes through a named transition** (SRS §5.2–5.3), and every
   transition writes a `BookingStatusHistory` row (actor, timestamp, reason). Never
   `UPDATE`-in-place without the history write in the same transaction.
4. **`LedgerEntry` is append-only and double-entry.** Every money movement writes a
   debit row and a credit row (linked via `relatedEntryId`); balances are always a
   `SUM()` over this table, never a stored, directly-editable column.
5. **`WORK_COMPLETED` requires `startOtpVerifiedAt` to be set first** (Integrity Rule
   10.3-2) — check this in the service layer, not just the UI.
6. **A `VerificationCall` becomes immutable once `submittedAt` is set** (FR-VC-08).
   Corrections are new linked rows, never edits to the original.
7. **`audit_log` is insert-only** (NFR-IN-03) — the Postgres role the app connects as
   should have no `UPDATE`/`DELETE` grant on it, in addition to the application check.
8. **Deletion is always soft** (FR-AD-09). Never write a hard `DELETE` against `User`,
   `Customer`, or `Provider` — deactivate (`isActive = false`) instead.
9. **Gateway callbacks are idempotent** (FR-PY-09): check `Payment.gatewayRef` for an
   existing terminal state before acting on a webhook — a duplicate callback is a no-op.
10. **Every operational number lives in the `Setting` table, not in code** (NFR-MA-01):
    SLA timers, calling hours, auto-release window, commission rates, surcharges, penalty
    values. If you catch yourself hardcoding one of these, stop and add a `Setting` key.

## How to work
- Follow the phases in `docs/TASKS_BACKEND.md` / `docs/TASKS_FRONTEND.md` in order.
  Phase 3 (verification + money) is the module that makes this project what it is —
  don't let it slip to the end of a session for time reasons.
- One module (or one clearly-scoped task-board item) per commit/PR. Write the Jest tests
  for a module in the same PR that implements it, not a follow-up.
- Every controller method: DTO-validated input (`class-validator`) → a service method →
  a typed response DTO. Controllers never call Prisma directly.
- Anything touching more than one table wraps in `prisma.$transaction`.
- If a requirement in the task board is ambiguous or the SRS doesn't cover a case you hit,
  stop and ask rather than guessing — this system's whole value is in verifiable
  correctness, not speed of assumption.
- Run lint + typecheck + tests before considering any task done.
````

---

## Part 2 — kickoff prompt (paste as your first message in a session)

```
Read AGENTS.md and docs/TRD_Smart_Home_Maintenance.md in full before doing anything else.

Then start Phase 1 of docs/TASKS_BACKEND.md:
1. Scaffold the npm workspaces monorepo exactly as laid out in TRD §3.
2. Add packages/prisma/schema.prisma (already provided in docs/) and run the first
   migration against a local Postgres (docker-compose up postgres first).
3. Bootstrap apps/api with NestJS + the Express adapter, global ValidationPipe, helmet,
   and Swagger.
4. Implement the Identity module tasks in docs/TASKS_BACKEND.md Phase 1, in the order
   listed, checking each box off in that file as you finish it.

Stop after the Identity module and show me what you've built before moving on to
Catalogue — I want to review the auth flow before you build anything on top of it.
```

Adjust the stopping point to whatever review cadence you want — the task boards are
written so you can hand OpenCode one module at a time, or a whole phase, without losing
track of what's left.
