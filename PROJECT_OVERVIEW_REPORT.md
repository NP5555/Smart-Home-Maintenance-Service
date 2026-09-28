# Project Overview Report — Smart Home Maintenance Services

**Report date:** 28 Sep 2026
**Repository:** `Smart-Home-Maintenance-Service`
**Written by:** OpenCode (automated codebase review)

---

## 1. What this project is, in plain English

**Smart Home Maintenance Services** is an online marketplace. It connects ordinary
homeowners (customers) with local tradesmen (providers — electricians, plumbers,
AC technicians, etc.), and then manages the entire job from start to finish.

Think of it as "Uber for home repairs", but with a heavy emphasis on trust and on
making sure nobody gets cheated.

The platform covers the full life of a job:

1. A customer browses services, sees prices, and picks a provider.
2. The customer books a time slot and pays (or agrees to pay cash).
3. The provider travels to the house, does the work, and photographs the result.
4. The platform **holds the money** — it does not pay the provider immediately.
5. The platform then **calls the customer** to confirm the work was actually done
   and is acceptable.
6. Only after that confirmation does the money get released to the provider.
7. If something goes wrong, there is a complaint, dispute, penalty and appeal process.

### The one big idea that defines the whole product

The project's own words: **"money is never released on the tradesman's word."**

Most freelance marketplaces just trust the worker to say "job finished". This one
does not. Every completed job goes into a verification queue, a human (or an
automated call/one-tap SMS link) contacts the customer, and money moves only after
a positive answer. Ratings can only be left if a verification record exists — this
is enforced in the database, not just in code.

### Who uses it

| User type | What they do |
|---|---|
| **Customer** | A homeowner, mostly on a phone, who needs something fixed. |
| **Provider** | The tradesman doing the work. Low-end Android, slow internet, limited English, so the app is built mobile-first with Urdu support and works as a PWA. |
| **Verification agent** | Staff member who calls customers to confirm jobs are genuinely done. |
| **Finance officer** | Staff member who handles releases, refunds, payouts and cash reconciliation. |
| **Administrator** | Approves providers, resolves disputes, configures the system. |

### Where it is meant to run

Launch scope is a single city (Lahore, Pakistan), six service categories,
English + Urdu (with right-to-left layout), Pakistani Rupees, and PKT timezone.
Money is stored as integer paisa — never as floating point numbers.

### What is explicitly out of scope for release 1

Native mobile apps, live GPS tracking, AI-based matching, video quotes, surge
pricing, insurance, multi-city operation.

---

## 2. How big is it

The project was planned as a serious, long build — not a small side project.

| Measure | Value |
|---|---|
| Functional modules planned (M1–M15) | 15 |
| Delivery phases | 6 (E0–E5) |
| Planned duration | ~13 weeks |
| Tickets in the tracker | **101** |
| Total story points | **507** |
| Database tables | **72** |
| Database enums | **52** |
| Git commits so far | 19 |
| Working code written so far | ~6,400 lines of TypeScript |

### The fifteen modules (M1–M15)

| ID | Module | ID | Module |
|---|---|---|---|
| M1 | Service catalogue & pricing | M9 | Ratings & reputation |
| M2 | Customer | M10 | Complaints & disputes |
| M3 | Service provider | M11 | Notifications |
| M4 | Search & matching | M12 | Administration & operations |
| M5 | Booking & scheduling | M13 | Maintenance plans |
| M6 | Work execution & evidence | M14 | Reporting |
| M7 | Verification & feedback | M15 | Conduct & penalties |
| M8 | Payments, escrow & payouts | | |

---

## 3. Technology being used

| Layer | Choice | Note |
|---|---|---|
| Language | TypeScript (Node 22) | Strict mode. |
| Monorepo | npm workspaces + Turborepo | `packages/*` and `apps/*`. |
| Backend framework | NestJS 11 on Fastify | One HTTP app, one worker app. |
| Database | PostgreSQL 16 + PostGIS 16 | Geospatial search on provider distance. |
| ORM | Prisma (client only) | Schema is owned by SQL migrations, never by `prisma migrate`. |
| Cache / queue | Redis 7 + BullMQ | |
| Object storage | MinIO / S3-compatible | Currently blocked (see §7). |
| Validation | Zod | Fail-fast config, request body schemas. |
| API docs | OpenAPI (Swagger) at `/api/docs` | |
| Errors | RFC-style `problem+json` | |
| Tests | Vitest | 110 unit + ~126 integration tests. |
| Lint | ESLint with custom rules | Bans floating promises, `any`, float money, and illegal `bookings.status` writes. |
| Frontend (planned) | Next.js 15, App Router, next-intl, Tailwind, shadcn/ui | **Not started.** |
| CI | GitHub Actions | Workflow file exists but has not been run yet. |

### Repository layout

```
apps/api            NestJS backend (HTTP + worker entrypoints)
packages/contracts  Types/enums/error codes shared by front and back end
packages/db         Migrations, seed, Prisma client generation
packages/domain     Framework-free business logic (Clock, Money, SlaCalendar,
                    booking state machine)
packages/config     Shared tsconfig / eslint / prettier + lint test fixtures
infra/              docker-compose: PostGIS, Redis, MinIO, Mailpit
smart-home-docs/    The engineering doc pack (SRS, TRD, ERD, schema, build prompt)
docs/               Design specs and implementation plans
```

### Documentation quality

This is genuinely one of the project's strengths. There is a complete, unusually
thorough documentation pack:

- **SRS v2.1** — the requirements spec, with every requirement given a testable
  acceptance criterion, and 25 numbered clarifications (`CL-01`…`CL-25`) that
  resolve contradictions found in the earlier v2.0 version.
- **TRD** — technical design: architecture, state machine, ledger posting recipes,
  verification engine, security, testing, CI/CD, ADRs.
- **ERD** + **`04_schema.sql`** — 72 tables, enums, constraints, triggers, views.
  This SQL file is the single source of truth for the data model.
- **Build prompt** — a phase-by-phase prompt set written for an AI coding agent.
- **Progress tracker** — a 1,822-line file tracking all 101 tickets, with an
  honest "what is built vs. what is still open" note on every ticket.

---

## 4. How far along is it

### Short answer

**Roughly 10–15% of the full product.** The backend foundation and the first two
product areas (onboarding, and the start of booking) are underway. **There is no
user-facing frontend at all**, and the money, verification, trust and release
phases have not been started.

### The numbers from the official tracker (101 tickets)

| Status | Count | Share |
|---|---|---|
| `DONE` | **0** | 0% |
| `IN REVIEW` | 12 | 12% |
| `IN PROGRESS` | 7 | 7% |
| `TODO` | 80 | 79% |
| `BLOCKED` | 2 | 2% |

| Acceptance criteria across all tickets | Count |
|---|---|
| Fully ticked `[x]` | 25 |
| Partially met `[~]` | 3 |
| Still open `[ ]` | **269** |

So: **0 of 101 tickets are formally complete**, and roughly **28 of 297
acceptance criteria are met** (about 9%). The 25 that are ticked are almost all
inside the 12 `IN REVIEW` tickets, and each of those tickets is still waiting on
a reviewer to formally sign it off. No phase gate has been closed and no release
tag has been pushed.

### Phase-by-phase reality check

| Phase | Name | Ticket progress | Reality |
|---|---|---|---|
| **E0** | Foundation & Infrastructure | 12 of 18 in review, CI not run | **Nearly done.** This is the strongest part of the project. |
| **E1** | Onboarding | 5 of 14 in progress, rest TODO | **Partially done.** Catalogue, addresses, provider profile, approval and search work. Frontend untouched. |
| **E2** | Transacting (search → booking → payment) | 3 of 21 in progress | **Early.** Booking create/read only. No payment, no offers, no execution. |
| **E3** | Verification & Money | 0 of 21 | **Not started.** |
| **E4** | Trust & Communication (disputes, penalties) | 0 of 14 | **Not started.** |
| **E5** | Depth, Hardening & Release | 0 of 13 | **Not started.** |

### What actually works today (verified by running the code)

These were re-run for this report and all pass:

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run build` — clean
- `npm test` — **110 unit tests pass** (64 API, 34 domain, 6 contracts, 6 config)
- Integration suite — **~126 tests across 10 files**, run against a live PostGIS
  and Redis
- The API boots and `/health/ready` reports database, redis, queues, settings and
  storage all ok
- Database integrity rules are proven by tests: audit log and ledger tables are
  insert-only, raw `UPDATE bookings.status` is rejected, hard-deleting a user is
  rejected, and an unbalanced ledger transaction is rejected at commit

Concretely, the following **backend modules** exist and are exercised:

| Module | What it does | State |
|---|---|---|
| Foundation | Monorepo, config, contracts, domain helpers (Money, Clock, SLA calendar) | Done |
| Platform | Settings with cache, audit log, idempotency, transactional outbox | Done |
| Identity | Register, phone OTP, login, refresh rotation with reuse detection, staff TOTP, RBAC policy guard | Done |
| Catalogue | Categories, services, checklists, commission rules, provider expertise | Done |
| Places | Cities and areas | Done (unticketed) |
| Customer | Addresses with PostGIS points, single-default enforcement | Partial (no profile/favourites/deactivate) |
| Provider | Profile, availability, time off, service areas, admin approve/reject | Partial (no documents, no submit gate, no payout account) |
| Search | Provider search with real geographic distance | Partial (distance only — no ranking weights, no 10k performance proof) |
| Booking | Create, read, list; state-transition table in the domain layer | Early (3 of 12 planned tasks) |
| Integration adapters | Mocks for payment, SMS, email, maps, telephony, WhatsApp, storage | Done (mocks) |

### Honest quality read

The work that *has* been done is of **above-average quality for this stage**:

- Money is integer paisa everywhere, with a lint rule banning floats.
- Business logic lives in a framework-free `packages/domain`, so it can be tested
  without a database.
- The booking state machine is written as data with generated transition tests.
- Custom ESLint rules actually fail the build (there are fixture files proving
  each banned pattern fails lint).
- A test fails if a database enum drifts out of sync with the shared contracts.
- A CI check asserts the migration file has not drifted from the canonical schema.
- Running the code has already surfaced and fixed real bugs (refresh-token reuse
  detection, a broken payment webhook, a non-transactional booking write).

The main caveat is **momentum and risk in the untested parts**: the product's
central promise — verified work, escrowed money, disciplined release — lives in
phases E3, which has not been started. The parts that are built are mostly the
plumbing, not the value proposition.

### What is missing to call it a working product

- **The entire frontend.** 36 of 101 tickets are FE. None have started. There is
  no Next.js app, no login page, no booking wizard, no admin console. Nothing is
  usable by a human yet.
- **Payments and money handling** (M8): checkout, escrow, release, refunds,
  payouts, reconciliation. The defining feature of the product.
- **Verification engine** (M7): the call queue, agent console, verification
  submission and release posting.
- **Job execution** (M6): departure, start OTP, geofenced check-in/out, photo
  evidence, service checklist, invoice.
- **Offers, auto-assign, reschedule, cancel, no-show** (rest of M5).
- **Slots endpoint** (SHM-025) — needed before search can actually show bookable
  providers.
- **Provider document uploads and CNIC encryption** (SHM-022) — currently approval
  has no document gate at all.
- **CI has never run**, and no branch protection is configured.
- **Production deployment** — no Docker images, no deploy pipeline, no backups,
  no runbooks.
- **Real payment gateway and telephony/SMS vendors** — blocked on the product
  owner choosing vendors.

---

## 5. Timeline reading

All 19 commits are dated between **23 Sep 2026 and 26 Sep 2026** — four days of
active building. The tracker itself was created 21 Sep 2026. So the project is
roughly one week old in terms of actual work, which is consistent with the
~10–15% figure given the 13-week plan.

The tracker also records one important caveat: the M5 booking build was being
executed by an AI agent, task-by-task with an independent reviewer per task, in a
mode with no per-task git commits. That means the recent booking work is less
easily auditable from git history than the earlier commits.

---

## 6. Documentation discipline

The tracker is unusually honest and worth calling out. Rather than ticking boxes,
each open ticket records:

- what is actually built (with file paths and test counts),
- what acceptance criteria are genuinely met,
- what is not built and why,
- and in at least one case a **known defect it did not want to hide**: the
  provider approve/reject endpoint does not write to the audit log, which breaks
  the project's own Definition of Done.

Two examples of criteria that were met in a different way than originally written,
and were documented rather than quietly ticked:

- Address validation returns `404` where the criterion said `422`.
- The booking state machine covers 10 statuses and 11 events, not the full
  22-status / 26-transition table the ticket asked for — a deliberate, recorded
  scope cut.

This is a good sign for the project's long-term health, and it means the
"0% done" in the official dashboard is pessimistic about how much usable backend
actually exists.

---

## 7. Blockers and open decisions

| Type | Item | Blocks | Needs |
|---|---|---|---|
| Technical | MinIO container images are no longer publicly pullable, so the four required buckets (evidence, documents, recordings, reports) cannot be created locally | SHM-002, SHM-022, SHM-041 | A reachable S3-compatible image |
| Product | OQ-01 — cash collection operating model | SHM-060, SHM-070 | Owner decision |
| Product | OQ-02 — breach categories and penalty severity | SHM-077, SHM-080 | Owner decision |
| Product | OQ-03 — payment gateway vendor | SHM-095 | Owner decision |
| Product | OQ-04 — telephony / SMS vendor | SHM-096 | Owner decision |
| Product | OQ-05 — real fee and threshold values | Seed, settings | Owner decision |
| Product | OQ-06 — provider security deposit | Possibly a new ticket | Owner decision |

All six product decisions are still `OPEN`. The build is running on stated
defaults with mock adapters, which is fine for now but will need resolving before
release.

---

## 8. Bottom line

**What it is:** A well-specified, ambitious three-sided marketplace that connects
Pakistani homeowners with verified tradesmen, and whose entire reason for
existing is trust — money is held on a double-entry ledger and released only after
a phone call confirms the customer is satisfied.

**How far along:** Early but not empty. The engineering foundation is genuinely
strong and well-tested (a full 72-table database with integrity rules, a clean
build, 236 passing tests, a strict lint policy). Roughly 10–15% of the 13-week
plan is built, all of it backend, all of it in the first two phases. By ticket
count the official figure is 0 of 101 `DONE`, though about 12 tickets are close
enough to be signed off and the tracker is stricter than most.

**What "completed" would still require:** an entire frontend, the money and
verification engine that the product is actually built around, job execution with
digital evidence, the full booking lifecycle, disputes and penalties, and a
production deployment. That is four to five more phases of work, and the estimate
of roughly 10–11 further weeks looks reasonable provided the phase gates are
actually closed and CI starts running.

**The single biggest risk:** the frontend has not been started at all. With 36
frontend tickets and no FE lead assigned in the tracker, the gap between "backend
APIs exist" and "a person can use this product" is currently the largest gap in
the project.

---

## Appendix — Verification performed for this report

| Check | Result |
|---|---|
| `npm test` (unit, all workspaces via Turborepo) | 110 passed, 0 failed (9 tasks successful) |
| Source scan of `apps/api/src` | 15 module folders, ~70 TypeScript files |
| Test scan of `apps/api/test` | 10 integration suites, ~126 test cases |
| Schema verification | `04_schema.sql` confirmed at 72 `CREATE TABLE`, 52 `CREATE TYPE` |
| Tracker status recount | 0 DONE, 12 IN REVIEW, 7 IN PROGRESS, 80 TODO, 2 BLOCKED |
| Acceptance-criteria recount | 25 ticked, 3 partial, 269 open |
| Git history | 19 commits, 23–26 Sep 2026 |
| CI workflow | `.github/workflows/backend.yml` present; 3 jobs defined; never executed |
