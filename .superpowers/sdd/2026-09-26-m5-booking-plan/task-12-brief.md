## Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run (from repo root): `npm run lint --workspace @smart-home/api` and `npm run lint --workspace @smart-home/domain`
Expected: both clean, zero errors

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @smart-home/api` and `npm run typecheck --workspace @smart-home/domain`
Expected: both clean

- [ ] **Step 3: Full unit test suite**

Run: `npm run test --workspace @smart-home/domain` and `npm run test --workspace @smart-home/api`
Expected: all green, including the pre-existing suites untouched by this plan

- [ ] **Step 4: Full integration suite**

Run (from `apps/api/`): `npx dotenv -e ../../.env -- npx vitest run --config vitest.integration.config.ts`
Expected: every file green — this includes `booking.test.ts`'s ~30 tests alongside every pre-existing integration test (identity, catalogue, customer-addresses, places, provider-profile, search, outbox, webhook, database-invariants) with zero regressions

- [ ] **Step 5: Build**

Run: `npm run build --workspace @smart-home/domain` and `npm run build --workspace @smart-home/api`
Expected: both clean

- [ ] **Step 6: Live smoke test against the running dev server**

If a dev server is already running (`npm run dev --workspace @smart-home/api` from an earlier session), it will have hot-reloaded these changes. Confirm the new routes are mapped by checking the server's stdout log for `Mapped {/api/v1/bookings...}` lines, or query the live OpenAPI document:

Run: `curl -sS http://localhost:3000/api/docs/openapi.json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const doc=JSON.parse(d);console.log(Object.keys(doc.paths).filter(p=>p.includes('/bookings')));});"`

Expected: a list including `/api/v1/bookings`, `/api/v1/bookings/{id}`, `/api/v1/bookings/{id}/accept`, and so on for every endpoint this plan added.

Then walk the full happy path live (register a customer and a provider, build the provider up via `readyBookableProvider`'s manual equivalent, create a booking, accept, depart, read the OTP from `/dev/inbox`, start, mark every checklist item done, complete) exactly as the earlier live-flow checks in this session's history did for search — confirming with real HTTP calls, not just the test suite, that a booking genuinely runs start to finish.

- [ ] **Step 7: Update the progress tracker**

Modify `07_PROGRESS_TRACKER.md`: add a change-log entry (§8) and move the relevant ticket rows — likely `SHM-033` through `SHM-043` in the `E2 · Phase 2` index (§4) — from `TODO` to `IN PROGRESS`, following the exact same honest-accounting style used for the M1-M4 entries added earlier (tick only the acceptance criteria genuinely met, note what's deferred and why, don't claim `DONE`). This plan's scope maps cleanly to `SHM-033` (state machine), `SHM-034` (`BookingStateService.apply()`), part of `SHM-037`/`SHM-041`/`SHM-042`/`SHM-043` (minus payment capture, which needs M8) — read each ticket's card in §5 before writing the evidence note, the same way the M1-M4 update did.

---

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** every endpoint in the design doc's §6 table has a task; §7 (start OTP) is Task 7; §8 (quote revisions) is Task 10; §9 (checklist/completion) is Tasks 9 and 11; §10's error-handling table is threaded through every task via `BookingStateService`'s two-step 409-then-403 check (Task 4) and the `notFound`-for-non-owners convention.
- **One thing this plan adds beyond the spec, called out explicitly rather than silently:** the spec's §5 side-effect table didn't mention `commission_rate_bp`, but it's a `NOT NULL` column on `bookings` with no default — Task 2 resolves it via the same provider-\>category-\>global precedence that SHM-019's undone acceptance criterion named, since no booking can be created without *some* value there.
- **Known follow-up, not in this plan:** the `bookings.status` lint rule mentioned in the progress tracker (meant to ban any write outside `BookingStateService`) was already noted as not firing; Task 12 doesn't fix it. Worth a dedicated small task later, since `BookingStateService` (Task 4) is exactly the thing it should be guarding.
