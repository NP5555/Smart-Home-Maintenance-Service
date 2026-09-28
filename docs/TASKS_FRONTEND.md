# Frontend Task Board — Smart Home Maintenance Services

Screens listed match SRS §9.1 exactly, grouped here by build phase so frontend and backend
land together — a screen isn't started until the backend endpoints it needs exist (check
`TASKS_BACKEND.md`). All screens: mobile-first, usable at 360px width (NFR-US-01).

**How to use this file:** check items off as PRs merge. Cross-cutting tasks at the bottom
apply to every screen — don't treat them as a separate phase, build them in from Phase 1.

---

## Phase 1 — Foundation
Public pages, auth, provider onboarding, admin approval

### Public
- [ ] Home + service categories
- [ ] Service listing (per category)
- [ ] Registration (customer, provider — provider flow includes document upload)
- [ ] Login
- [ ] Password recovery (email or SMS code)

### Customer (auth shell only — dashboard proper starts Phase 2)
- [ ] Profile & password screen
- [ ] Address book (add/edit saved addresses with map pin)

### Provider (onboarding slice)
- [ ] Documents screen: CNIC / trade certificate / optional character certificate upload, approval status shown
- [ ] Service & price list: pick catalogue services, set price within admin band
- [ ] Availability calendar: weekly slots + leave days

### Admin
- [ ] Provider approval queue: review documents, approve/reject with reason
- [ ] Provider & customer management (list/search/deactivate — never a delete button)
- [ ] Catalogue management: categories, services, pricing model, emergency/plan/warranty/high-risk flags
- [ ] Roles & permissions screen (agent / finance / admin)
- [ ] Settings screen (maps to `Setting` table — commission, SLA timers, calling hours, etc.)
- [ ] Audit log viewer (filter by actor, entity, date)

**Definition of done — Phase 1:** a provider can register, upload documents, and get
approved by an admin, entirely through the UI, matching the backend's Phase 1 DoD.

---

## Phase 2 — Transacting
Search, booking flow, provider job execution

### Customer
- [ ] Search & filter results (location, experience, expertise, rating, price range, available-today, verified-only, min completed jobs) with distance shown per result
- [ ] Provider profile view (experience, expertise, rating, remarks, distance)
- [ ] Booking form: slot picker (only free slots selectable), problem description, up to 5 photos
- [ ] Booking summary & confirmation (estimated price, visit/inspection fee, cancellation policy shown before confirm)
- [ ] Booking detail with live status (reflects every state in the booking state machine)
- [ ] Reschedule / cancel actions, with the fee rule surfaced before confirming
- [ ] In-app messaging thread on a booking (numbers masked both directions)

### Provider
- [ ] Dashboard: today's jobs
- [ ] Job offer screen with acceptance countdown
- [ ] Job detail screen
- [ ] Start-work OTP entry
- [ ] Checklist + photograph capture (before/after, geofenced check-in/out handled silently in the background)
- [ ] Revised quote form (for inspection-first / extra-work services), sent for customer in-app approval
- [ ] Completion submission: parts/materials entry, itemised invoice preview

**Definition of done — Phase 2:** a customer can complete a full booking flow, and a
provider can take that job from acceptance through completion submission, on a 360px
viewport.

---

## Phase 3 — Verification and money
Agent console, finance screens, customer/provider money views

### Verification agent
- [ ] Verification queue with SLA countdown
- [ ] Agent console: booking + invoice + before/after photos + provider history + the fixed questionnaire (SRS §4.5), on one screen — this is the screen efficiency note in SRS §2.3 calls out explicitly, so keep it to one scroll, no tab-hopping
- [ ] Call attempt log (per booking)

### Finance
- [ ] Escrow held view
- [ ] Release queue
- [ ] Refunds screen
- [ ] Payout batch screen
- [ ] Cash reconciliation screen
- [ ] Commission debt list

### Customer
- [ ] Booking history with status, invoice, provider, and the verification-call feedback
- [ ] Invoice view (itemised: service, extras, parts, surcharge, discount, total)
- [ ] Re-book a previous provider from history
- [ ] Favourite providers list

### Provider
- [ ] Earnings dashboard: held / releasable / paid, commission deducted, weekly/monthly totals
- [ ] Payout request screen
- [ ] Ratings & remarks view (read-only, published-from-verified-call only)
- [ ] Reply to a remark (one reply, not editable after posting)

**Definition of done — Phase 3:** every screen a verification agent needs is on one page;
customers and providers can see money move (held → released) without contacting support.

---

## Phase 4 — Trust and communication
Complaints, disputes, penalties, notifications

### Customer
- [ ] Complaint form (attach to a booking, photo evidence)

### Provider
- [ ] Complaint form (unsafe premises / non-payment / abusive conduct)
- [ ] Conduct record: current demerit points, expiry dates, penalty schedule reference
- [ ] Penalty appeal form

### Admin
- [ ] Complaint queue (severity-sorted, safety issues pinned to top)
- [ ] Dispute queue: evidence floor (OTP, geofence, photos, checklist, invoice) + verification record side by side, resolution action (full release / partial / full refund / refund+penalty)
- [ ] Penalty & appeal management

### All roles
- [ ] In-app notification center (list + unread state) reflecting every booking/provider/admin event from FR-NT-02/03/04
- [ ] Email/SMS are backend-only — no frontend task, but surface delivery failures to admins if the notification log shows repeated `FAILED`

**Definition of done — Phase 4:** a complaint can be filed, reviewed with full evidence,
and resolved through the UI end to end, with the provider seeing their conduct record
update.

---

## Phase 5 — Depth
Maintenance plans, reporting, operations board

### Customer
- [ ] Maintenance plans: browse, subscribe, view remaining entitlements & renewal date, cancel

### Admin
- [ ] Operations board: today's bookings by state, verification queue depth, SLA breaches, open disputes, total escrow held
- [ ] Reports screen: monthly, revenue, provider performance, verification — each exportable to PDF/Excel, printable

**Definition of done — Phase 5:** an admin can see the whole platform's health on one
board and pull any of the 4 report types without a developer's help.

---

## Cross-cutting (build in from Phase 1, don't defer)
- [ ] Mobile-first layout, fully usable at 360px width (NFR-US-01)
- [ ] English + Urdu, with right-to-left rendering for Urdu (NFR-US-02)
- [ ] Form errors shown as visible text next to the field, never by colour alone (NFR-US-03)
- [ ] Visible keyboard focus on every interactive element (NFR-US-04)
- [ ] Typed API client generated/shared against `packages/contracts` (kept in sync with the backend — see `TASKS_BACKEND.md`)
- [ ] Auth flow: JWT access token in memory, refresh token rotation, silent re-auth
- [ ] Image upload that tolerates a slow/interrupted connection and resumes or retries (NFR-PE-04) — matters most for the provider's evidence-capture screens on 3G
- [ ] Every screen that shows a phone number must show the masked one, never the real one (NFR-PR-01)
