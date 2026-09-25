# Software Requirements Specification — Smart Home Maintenance Services

| Field | Detail |
|---|---|
| Document | Software Requirements Specification (SRS) |
| Version | 2.1 (build baseline) |
| Supersedes | SRS v2.0 (4 Sep 2026), which superseded FR.pdf |
| Companion documents | `02_TRD.md` (technical design), `03_ERD.md` + `04_schema.sql` (data model), `05_CURSOR_BUILD_PROMPT.md` (build instructions) |
| Currency / time zone | PKR / Asia/Karachi (PKT, UTC+5) |

> **What changed in 2.1.** v2.0 is functionally complete but contained a number of ambiguities and internal contradictions that would have been discovered only during build or test (cash collection timing, the 25-point integrity rule vs. the demerit schedule, `per Day` vs `hourly` pricing, where `CALL_IN_PROGRESS` lives, and others). Section 3 resolves every one of them with a stated decision. All v2.0 requirement IDs are preserved unchanged; new requirements are appended with new IDs and marked **v2.1**. Nothing from FR.pdf has been dropped (Appendix A).

---

## 1. Introduction

### 1.1 Purpose
Specify, in testable form, the requirements for a web marketplace that connects households with verified tradesmen and manages every engagement end to end: discovery, booking, execution, **telephone-verified work acceptance**, escrowed payment, payout, ratings, disputes and provider conduct.

### 1.2 Conventions
- `FR-XX-nn` functional, `NFR-XX-nn` non-functional, `CL-nn` clarification/decision, `BR-nn` business rule (configurable value), `OQ-nn` open question for the product owner.
- Priority: **H** required for a working system, **M** required for a complete system, **L** desirable.
- Source: **FR** (FR.pdf), **v2.0** (added in SRS 2.0), **v2.1** (added here).
- *shall/must* = mandatory; *may* = optional. States, tables and fields are `monospaced`.
- Every requirement has an acceptance criterion (AC). ACs are written to be directly convertible into automated tests.

### 1.3 Scope
Three-sided responsive web application (mobile-first, PWA for providers) serving **customers**, **service providers** and **platform staff** (verification agent, finance officer, administrator). Launch: single city, six categories.

**The defining rule:** money is never released on the tradesman's word. Completion puts the job into a verification queue; the platform contacts the customer (staffed call or automated confirmation), records structured feedback, and only then releases payment. Ratings can exist only where a verification record exists — enforced in the database.

**Out of scope (release 1):** native apps, live GPS tracking, AI matching, video quotes, surge pricing, insurance, warranty retention, IoT verification, multi-city operations (schema is city-aware).

### 1.4 Definitions
| Term | Meaning |
|---|---|
| Provider / workman | Registered, approved tradesman who performs work. |
| Verification record | The single, write-once record (`verification_calls`) holding the outcome and questionnaire for a booking. |
| Tier A / Tier B | Staffed telephone call / automated confirmation (SMS-WhatsApp one-tap link or IVR). |
| Escrow | Funds captured from the customer and held on the platform ledger until a release-permitting outcome. |
| Evidence floor | Start OTP, geofenced check-in/out, timestamped before/after photos, service checklist, itemised invoice. |
| Approved total | Original quote + all customer-approved revised quotes. The final amount can never exceed it. |
| Demerit points | Points recorded against a provider for *verified* breaches; they expire and decay. |
| Calling hours | 08:00–22:00 PKT. No outbound verification contact outside them. |
| Minor units | Money is stored as integer paisa (1 PKR = 100 paisa). |

---

## 2. Overall Description

### 2.1 Product perspective
A new, self-contained platform acting as **intermediary of record** — it holds the money, the evidence, the verification outcome and the reputation. External dependencies: payment gateway (card + mobile wallet), SMS gateway, email, maps/geocoding, telephony (click-to-call + recording), optional WhatsApp Business API. Every dependency sits behind an adapter with a mock implementation so the system is fully demonstrable offline.

### 2.2 Modules
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

### 2.3 User classes
| Class | Characteristics | Design implication |
|---|---|---|
| Customer | Occasional, time-pressured, mostly mobile. | 3-tap booking; clear price & cancellation summary. |
| Provider | Daily use, low-cost Android, slow 3G, limited English. | PWA, Urdu + icons, large targets, resumable uploads, offline-tolerant evidence capture. |
| Verification agent | One screen for a whole shift. | Single-screen console, keyboard shortcuts, zero navigation per call. |
| Finance officer | Releases, refunds, payouts, cash reconciliation. | Tables with bulk actions, exports, ledger drill-down. |
| Administrator | Approves, resolves, configures, reports. | Queues + operations board + settings. |

### 2.4 Operating environment
Modern browsers; fully usable at 360 px; English and Urdu (RTL); provider flows usable on 3G; server stack defined in the TRD (Node.js/TypeScript, PostgreSQL + PostGIS, Redis job queue).

### 2.5 Constraints (carried from v2.0, all mandatory)
1. Every money movement happens inside a DB transaction and is posted to a **double-entry ledger**; balances are derived, never directly editable.
2. Gateway callbacks are idempotent.
3. Verification records and the audit log are **insert-only**; corrections are linked amendment rows.
4. No user who has participated in a booking is ever physically deleted.
5. All timings, fees, thresholds and windows live in configuration (Section 13), not code.

### 2.6 Assumptions
- Customer mobile numbers are genuine (OTP-verified) and reachable by call and SMS.
- Providers have a camera-equipped smartphone with location services.
- Cash is a first-class path, expected to be the majority at launch.
- The gateway supports **capture + refund + signed webhooks**. Delayed capture/authorisation holds are *not* required: escrow is implemented on the platform ledger (CL-10).

---

## 3. Clarifications and Resolved Ambiguities (new in v2.1)

Each item states the problem found in v2.0 and the decision now binding on design and test.

| ID | Issue in v2.0 | Decision |
|---|---|---|
| CL-01 | §3.2 names pricing models *Flat / per Day / Inspection-first*; FR-CAT-02 says *flat / hourly / inspection-first*. | Pricing models are `FLAT`, `TIME_BASED` and `INSPECTION_FIRST`. `TIME_BASED` carries a `time_unit` of `HOUR` or `DAY`. Both readings are satisfied. |
| CL-02 | §4.4 has a `CALL_IN_PROGRESS` state; the §5.2 state table does not. | Call progress is a **verification sub-state** (`verification_calls.status`: `QUEUED → LOCKED → SUBMITTED`), not a booking state. The booking stays `AWAITING_VERIFICATION` during the call. Keeps the booking machine smaller and lets one call lock be released on agent timeout. |
| CL-03 | "Four outcomes" (§4.6) vs. five values in `verification_calls.outcome`. | Agents choose from four outcomes. `AUTO_RELEASED` and `LINK_CONFIRMED` are **system outcomes** written by the scheduler / Tier B flow. |
| CL-04 | §5.3 sends `AWAITING_VERIFICATION → REWORK → IN_PROGRESS` but `REWORK` is not a defined state. | New state `REWORK_REQUIRED`. Provider must re-enter a fresh start OTP to move to `IN_PROGRESS` (a rework is a new visit). Missing the 48 h window counts as a failed rework. |
| CL-05 | `REQUESTED → DECLINED/EXPIRED` then "offered to next provider" — ambiguous whether the booking dies. | `DECLINED` and `EXPIRED` are **offer** statuses (`booking_offers`). The booking stays `REQUESTED` while offers cascade down the ranked list. After `BR-06` offers or `BR-07` minutes without acceptance the booking becomes `UNFULFILLED` and any payment is refunded in full. |
| CL-06 | `ACCEPTED` and `SCHEDULED` had no distinguishing rule. | `ACCEPTED` = provider said yes. The system moves to `SCHEDULED` in the same transaction once the slot lock is confirmed and payment state is valid (online: captured; cash: n/a). They remain separate so provider acceptance and slot confirmation are auditable separately. |
| CL-07 | When is an online booking paid? | **At checkout.** An online booking is created in `PENDING_PAYMENT` and is not offered to any provider until capture is confirmed by webhook; unpaid after `BR-05` minutes → `ABANDONED`. Inspection-first bookings capture only the visit fee at checkout. |
| CL-08 | **Cash collection timing contradiction.** §4.1 says the call happens after the tradesman has left; §4.8 says the call precedes the cash handover. | Cash jobs get **queue priority** and a 15-minute SLA (`BR-12`). The provider leaves the premises and waits nearby; after a release-permitting outcome the provider app shows "Collect PKR X". The customer may alternatively pay by transfer to the provider (FR-PY-01). The provider confirms receipt; the customer receives an SMS receipt with a "report a problem" link. If the call cannot be completed quickly, the provider may leave and collection happens on a return visit or by transfer. **OQ-01** asks the owner to confirm this operating model. |
| CL-09 | Cash job + unreachable customer: the customer was told to withhold payment, so "auto-release" releases nothing. | For cash jobs, `AUTO_RELEASED` means **authorised to collect**. The provider may collect/receive transfer and confirm receipt; commission is then debited. The customer keeps the 7-day complaint window. |
| CL-10 | Gateway "held funds / delayed capture" dependency is unrealistic for most PK gateways. | Funds are **captured** into the platform merchant account and **held on the ledger** (`ESCROW` account per booking). Release, partial release and refund are ledger postings plus, for refunds, a gateway refund call. |
| CL-11 | Final amount vs. escrow mismatch was undefined. | `final_amount ≤ approved_total` is a hard rule. For online jobs, approved revisions require an in-app **top-up payment** before work continues. At release, any escrow above `final_amount` is refunded automatically. |
| CL-12 | Parts/materials logged on site had no approval rule. | Parts not included in the original quote are extras and require a revised quote (FR-EX-05). |
| CL-13 | Inspection-first job where the customer rejects the revised quote. | The job completes with the visit fee only, and still passes through verification. |
| CL-14 | **Penalty contradiction.** §7.3 says any integrity breach ≥ 25 points → permanent block; §7.2 lists some 25-point breaches with "suspension". | Every breach type carries a category: `RELIABILITY`, `QUALITY`, `INTEGRITY`, `SAFETY`, `CONDUCT`. The **harsher** of the schedule consequence and the threshold consequence applies. Classified: overcharging and falsified completion = `INTEGRITY` (→ permanent block); unsafe work = `SAFETY` (→ suspension, not automatic block). Admin can reduce on appeal. **OQ-02** asks the owner to confirm. |
| CL-15 | Demerit expiry (180 days) and decay (1 point per 30 clean days) interaction undefined. | Each award has `points_remaining`. Daily job: award expires fully at `awarded_at + 180 d`; independently, if 30 days pass with no new breach, one point is removed from the **oldest** active award. Active total = Σ `points_remaining` of unexpired awards. |
| CL-16 | Threshold consequences could re-fire on every recalculation. | A consequence fires once per upward crossing (`threshold_events`). Falling below and re-crossing fires again. |
| CL-17 | FR-RT-04 "weighted toward the most recent twenty jobs" had no formula. | Score = weighted mean of per-job ratings; the most recent 20 rated jobs weight `BR-40` (default 2), older jobs weight 1. Displayed to one decimal. |
| CL-18 | "Continuous poor rating" (FR-AD-08) undefined. | Provider is auto-flagged when the rolling average of the last 10 rated jobs < 3.0 (FR-AD-11). Blocking remains a human decision. |
| CL-19 | FR-VC-10 "linked to his own account" undefined. | Linked = same phone number, same CNIC, same email, or a relationship declared by staff in `staff_conflicts`. The console refuses such bookings. |
| CL-20 | SLA clock vs. calling hours. | The 30-minute SLA counts only within calling hours. A job completed at 21:50 has its clock paused at 22:00 and resumed at 08:00. |
| CL-21 | Customer late-cancellation fee on a cash booking had no collection path. | The fee is posted to a `CUSTOMER_RECEIVABLE` ledger account and added to the customer's next booking summary. |
| CL-22 | Warranty claim after payment has already been released. | A claim reopens the original booking into `REWORK_REQUIRED` with no funds held. A failed warranty rework enters `DISPUTED`; financial recovery uses the penalty mechanism (wallet debit / debt). |
| CL-23 | Provider cancellation — is the booking re-offered? | `CANCELLED_PROVIDER` is terminal with a full refund; the customer gets a one-tap "rebook with next best provider" pre-filled from the cancelled booking. |
| CL-24 | Money stored as `decimal`. | Stored as `BIGINT` minor units (paisa) to eliminate rounding error. Commission rounds half-up to the nearest paisa, remainder to the provider. |
| CL-25 | Numbering glitches in v2.0 (§7.1 starts at 5, §10.3 starts at 10). | Editorial only; renumbered here. |

### 3.1 Open questions for the product owner
| ID | Question | Default used until answered |
|---|---|---|
| OQ-01 | Confirm the cash collection model in CL-08. | As CL-08. |
| OQ-02 | Confirm breach categories and "harsher consequence wins" (CL-14). | As CL-14. |
| OQ-03 | Which payment gateway (Safepay, PayFast, JazzCash, Easypaisa…)? | Mock gateway; adapter interface ready. |
| OQ-04 | Which telephony provider can deliver click-to-call + recording to PK numbers? | Mock telephony + manual-dial mode with recording upload. |
| OQ-05 | Real values for fees, commission and thresholds (Section 13 values are placeholders). | Section 13 defaults. |
| OQ-06 | Security deposit for high-value categories (§7.4) — in release 1 or not? | Modelled, disabled by config. |

---

## 4. Service Catalogue (M1)

### 4.1 Launch categories
Plumbing · Sanitary & bathroom · Electrical · Appliance repair · Carpentry & furniture · Paint, masonry & waterproofing. Cleaning/pest control and Security/smart-home exist as records flagged `is_active = false`. Full service list as SRS v2.0 §3.1 (seed data, NFR-MA-02).

### 4.2 Pricing models
| Model | Customer sees at booking | Captured at checkout (online) |
|---|---|---|
| `FLAT` | Fixed price | Full price (+ surcharge) |
| `TIME_BASED` (HOUR/DAY) | Rate × estimated units, marked "estimate" | Estimated total |
| `INSPECTION_FIRST` | Visit fee + "final quote after diagnosis" | Visit fee only |

### 4.3 Service attributes
`is_emergency_eligible`, `is_plan_eligible`, `warranty_days` (0 = none), `is_high_risk` (forces Tier A), `expected_duration_min`, `checklist` (ordered items, some requiring a photo).

---

## 5. Work Verification and Payment Release

### 5.1 Evidence floor (captured on every job)
Start OTP · geofenced check-in/check-out · timestamped before/after photos (server time, not device time) · completed service checklist · itemised invoice with approval trail for every extra.

### 5.2 Tier routing (evaluated at `WORK_COMPLETED`)
A job routes to **Tier A** if *any* rule matches; reasons are stored on the verification record.

| Rule | Trigger |
|---|---|
| R1 | Provider has < `BR-20` (5) verified jobs |
| R2 | `final_amount` > `BR-21` |
| R3 | Service `is_high_risk` |
| R4 | Evidence anomaly: time on site < `BR-23` × expected duration; missing required photo; check-in outside geofence |
| R5 | Provider has any active demerit points |
| R6 | Prior complaint/dispute between this customer and provider |
| R7 | Extras added on site (any approved revision) |
| R8 | Cash payment mode *(v2.1: cash jobs always Tier A because the call gates the cash handover)* |
| R9 | Random sample at rate `BR-22` (10 %) |
| R10 | `verification.force_tier_a = true` (**shipping default**, per v2.0 implementation note) |

Otherwise **Tier B**. No Tier B response in `BR-24` (24 h) → escalate to Tier A.

### 5.3 Questionnaire (fixed; no free notes as feedback)
1. Work completed? `FULL / PARTIAL / NONE`
2. Quality, punctuality, conduct, site cleanliness — each 1–5; published rating = mean of the four.
3. Was any amount demanded beyond the approved price? `YES/NO` (+ amount if yes)
4. Arrived in uniform? Carried own tools? `YES/NO` each
5. Verbal consent to release payment `YES/NO`
6. Customer remark (agent-transcribed free text, published)
7. Auto-captured: agent, attempt id, duration, recording reference, timestamps, tier, routing reasons.

Tier B collects items 1, 2, 3 and 5 through the one-tap form; no remark is required.

### 5.4 Outcomes
| Outcome | Booking goes to | Money | Other effects |
|---|---|---|---|
| `VERIFIED_SATISFIED` | `VERIFIED` → `PAYMENT_RELEASED` | Release | Rating + remark publish; job count +1 |
| `VERIFIED_WITH_ISSUE` | `VERIFIED` → `PAYMENT_RELEASED` | Release | Complaint auto-opened; provider flag (3 flags / 90 d → admin review) |
| `REWORK_REQUIRED` | `REWORK_REQUIRED` | Held | 48 h window; 2nd failure → `DISPUTED` |
| `DISPUTED` | `DISPUTED` | Frozen | Admin dispute queue |
| `LINK_CONFIRMED` *(system)* | `VERIFIED` → `PAYMENT_RELEASED` | Release | Rating publishes from Tier B answers |
| `AUTO_RELEASED` *(system)* | `AUTO_RELEASED` → `PAYMENT_RELEASED` | Release (cash: authorised to collect) | **No rating**; 7-day complaint window |

Rule: if the questionnaire says "amount demanded beyond approved price = YES" or "work completed = NONE", the only outcome the console allows is `DISPUTED`.

### 5.5 Unreachable customer
Attempt 1 within SLA → attempts 2 and 3 in a **different time band** (bands: 08–12, 12–17, 17–22) within 24 h → send SMS + WhatsApp one-tap link → at 72 h after completion auto-release, suppress rating → customer may complain for 7 days.

---

## 6. Booking Lifecycle (M5)

### 6.1 States
| State | Meaning | Terminal |
|---|---|---|
| `PENDING_PAYMENT` | Online checkout started; not visible to providers | |
| `ABANDONED` | Online payment not completed in time | ✔ |
| `REQUESTED` | Offer(s) out to provider(s) | |
| `UNFULFILLED` | No provider accepted; refunded | ✔ |
| `ACCEPTED` | Provider accepted | |
| `SCHEDULED` | Slot confirmed & locked | |
| `EN_ROUTE` | Provider departed | |
| `IN_PROGRESS` | Start OTP entered | |
| `QUOTE_REVISION` | Revised quote awaiting customer approval (and top-up) | |
| `WORK_COMPLETED` | Completion evidence submitted (transient) | |
| `AWAITING_VERIFICATION` | In verification queue; funds frozen | |
| `REWORK_REQUIRED` | Rework window open; funds held | |
| `VERIFIED` | Release-permitting outcome recorded | |
| `AUTO_RELEASED` | 72 h with no reachable customer | |
| `DISPUTED` | Funds frozen pending admin | |
| `PAYMENT_RELEASED` | Provider credited / cash settled | |
| `PARTIALLY_REFUNDED` | Dispute resolved with partial release | |
| `REFUNDED` | Full refund | |
| `CANCELLED_CUSTOMER` / `CANCELLED_PROVIDER` | Cancelled | ✔ |
| `NO_SHOW` | Provider or customer no-show (`no_show_party`) | ✔ |
| `CLOSED` | Warranty elapsed with no claim / refund completed | ✔ |

### 6.2 Transition table (the only legal moves)
| # | From | Event | To | Actor | Guard / effect |
|---|---|---|---|---|---|
| T1 | — | `checkout` (online) | `PENDING_PAYMENT` | Customer | Slot hold created |
| T2 | — | `checkout` (cash) | `REQUESTED` | Customer | Slot hold; first offer sent |
| T3 | `PENDING_PAYMENT` | `payment_captured` | `REQUESTED` | System (webhook) | Idempotent; ledger capture posting |
| T4 | `PENDING_PAYMENT` | `payment_timeout` | `ABANDONED` | System | Hold released |
| T5 | `REQUESTED` | `offer_declined` / `offer_expired` | `REQUESTED` | Provider / System | Next-ranked offer; history row |
| T6 | `REQUESTED` | `offers_exhausted` | `UNFULFILLED` | System | Full refund |
| T7 | `REQUESTED` | `accept` | `ACCEPTED` → `SCHEDULED` | Provider → System | Provider approved for service; slot lock succeeds |
| T8 | `REQUESTED`, `ACCEPTED`, `SCHEDULED` | `cancel_by_customer` | `CANCELLED_CUSTOMER` | Customer | Fee if < `BR-02` h to slot (SCHEDULED only) |
| T9 | `ACCEPTED`, `SCHEDULED`, `EN_ROUTE` | `cancel_by_provider` | `CANCELLED_PROVIDER` | Provider | Full refund; reliability event; demerits if < 4 h |
| T10 | `SCHEDULED` | `reschedule` | `SCHEDULED` | Customer | Once free, ≥ 4 h before; new slot must lock |
| T11 | `SCHEDULED` | `depart` | `EN_ROUTE` | Provider | Customer notified |
| T12 | `SCHEDULED`, `EN_ROUTE`, `REWORK_REQUIRED` | `start_work` | `IN_PROGRESS` | Provider | Valid OTP; geofence check-in recorded |
| T13 | `SCHEDULED`, `EN_ROUTE` | `report_no_show` | `NO_SHOW` | Customer or Provider | Only ≥ `BR-04` min after slot start |
| T14 | `IN_PROGRESS` | `raise_revision` | `QUOTE_REVISION` | Provider | |
| T15 | `QUOTE_REVISION` | `approve_revision` | `IN_PROGRESS` | Customer (+ System on top-up capture) | Online: top-up captured first |
| T16 | `QUOTE_REVISION` | `reject_revision` | `IN_PROGRESS` | Customer | Inspection-first: provider may only complete with visit fee |
| T17 | `IN_PROGRESS` | `complete` | `WORK_COMPLETED` → `AWAITING_VERIFICATION` | Provider → System | OTP set, checklist complete, after-photos present, `final ≤ approved_total`; tier routed |
| T18 | `AWAITING_VERIFICATION` | `outcome_verified` / `link_confirmed` | `VERIFIED` | Agent / System | Immutable record |
| T19 | `AWAITING_VERIFICATION` | `outcome_rework` | `REWORK_REQUIRED` | Agent | If `rework_count` ≥ 1 already failed → `DISPUTED` |
| T20 | `AWAITING_VERIFICATION` | `outcome_disputed` | `DISPUTED` | Agent | Funds frozen |
| T21 | `AWAITING_VERIFICATION` | `auto_release` | `AUTO_RELEASED` | System | ≥ 72 h since completion |
| T22 | `REWORK_REQUIRED` | `rework_window_expired` | `DISPUTED` | System | Counts as failed rework |
| T23 | `VERIFIED`, `AUTO_RELEASED` | `release` | `PAYMENT_RELEASED` | System (online) / Provider cash-confirm | Ledger release + commission |
| T24 | `DISPUTED` | `resolve_release` / `resolve_partial` / `resolve_refund` | `PAYMENT_RELEASED` / `PARTIALLY_REFUNDED` / `REFUNDED` | Admin | Right-of-reply satisfied |
| T25 | `PAYMENT_RELEASED` | `warranty_claim` | `REWORK_REQUIRED` | Customer | Within `warranty_days` |
| T26 | `PAYMENT_RELEASED`, `PARTIALLY_REFUNDED`, `REFUNDED` | `close` | `CLOSED` | System | Warranty elapsed (or immediately for `REFUNDED`) |

Every transition writes `booking_status_history` (from, to, event, actor, reason, metadata) in the same DB transaction. Any other move is rejected with `409 ILLEGAL_TRANSITION`.

---

## 7. Functional Requirements

### 7.1 M1 — Service Catalogue & Pricing
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-CAT-01 | Admin maintains categories and services. | H | v2.0 | Admin can create/edit/deactivate; inactive services never appear in search. |
| FR-CAT-02 | Each service has description, base price or band, expected duration, pricing model (CL-01). | H | v2.0 | Save is rejected if any is missing; `min ≤ base ≤ max`. |
| FR-CAT-03 | Provider expertise binds to catalogue services; offers only for approved services. | H | v2.0 | Offer engine never offers a service absent from `provider_services` with `status=APPROVED`. |
| FR-CAT-04 | Provider may set own price within the band. | M | v2.0 | Price outside band → 422. |
| FR-CAT-05 | Commission % set globally, per category or per provider. | H | v2.0 | Resolution order provider > category > global; effective rate snapshotted on booking. |
| FR-CAT-06 | Emergency-eligible services allow same-day booking with surcharge. | M | v2.0 | Surcharge line appears only when `is_emergency=true` and service eligible. |
| FR-CAT-07 | Flags: plan-eligible, warranty days, high-risk. | M | v2.0 | High-risk job always routes to Tier A (R3). |
| FR-CAT-08 | Each service carries an ordered checklist; items may require a photo. | H | v2.1 | Completion blocked until all required items are ticked and required photos uploaded. |

### 7.2 M2 — Customer
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-CU-01 | Register and log in. | H | FR | Register → OTP → logged in; wrong password 5× → rate-limited. |
| FR-CU-02 | View/update profile; change password. | H | FR | Password change requires current password and revokes other sessions. |
| FR-CU-03 | Mobile verified by OTP at registration. | H | v2.0 | Unverified account cannot book. Changing the number requires a new OTP. |
| FR-CU-04 | Password recovery by email or SMS OTP. | H | v2.0 | Code single-use, expires in 10 min, 5 attempts max. |
| FR-CU-05 | Multiple saved addresses with area + map pin. | H | v2.0 | Address must geocode to a point inside a served area. |
| FR-CU-06 | Booking history with status, invoice, provider, own verification feedback. | H | v2.0 | Customer sees own questionnaire answers after submission. |
| FR-CU-07 | Re-book a previous provider from history. | L | v2.0 | Pre-fills service, address, provider. |
| FR-CU-08 | Favourite providers. | L | v2.0 | Toggle; favourites filter in search. |
| FR-CU-09 | Deactivate account; PII anonymised; financial records kept. | M | v2.0 | Name/email/phone replaced by tokens; bookings & ledger intact; cannot log in. |

### 7.3 M3 — Service Provider
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-SP-01 | Register/login; account `PENDING` until approved. | H | FR | Pending provider can log in to complete profile but receives no offers. |
| FR-SP-02 | Profile: name, experience, expertise checklist, qualification, picture, location. | H | FR | All required before "submit for approval" is enabled. |
| FR-SP-03 | View/update profile; change password. | H | FR | As FR-CU-02. |
| FR-SP-04 | View ratings. | H | FR | Shows score, count, distribution. |
| FR-SP-05 | View remarks. | H | FR | Shows first-name+initial only (FR-RT-06). |
| FR-SP-06 | Upload CNIC (front/back), trade certificate, optional character certificate; approval blocked until identity verified. | H | v2.0 | Approve button disabled until CNIC doc `VERIFIED`. |
| FR-SP-07 | Weekly availability + leave; only free slots bookable. | H | v2.0 | Slot generator excludes leave, existing bookings and travel buffer `BR-08`. |
| FR-SP-08 | Service area: city, areas, radius from base. | H | v2.0 | Provider appears only for addresses within radius **and** in listed areas. |
| FR-SP-09 | Accept/decline within countdown; silence forfeits. | H | v2.0 | After `BR-01` min offer → `EXPIRED`, next provider offered. |
| FR-SP-10 | Earnings: held, releasable, paid, commission, weekly/monthly. | H | v2.0 | Figures equal ledger-derived balances to the paisa. |
| FR-SP-11 | Request payout to registered bank/wallet account. | H | v2.0 | Only positive released balance ≥ `BR-51`; creates `payouts` row `REQUESTED`. |
| FR-SP-12 | One reply per remark; not editable. | M | v2.0 | Second reply → 409. |
| FR-SP-13 | Tier badges from verified jobs only. | L | v2.0 | Auto-released jobs don't count toward badges. |
| FR-SP-14 | View conduct record, active points, expiry dates. | M | v2.0 | Shows each award, remaining points, expiry, decay progress. |

### 7.4 M4 — Search & Matching
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-SR-01 | Filter by location, experience, expertise, rating. | H | FR | Each filter narrows the result set correctly (fixture test). |
| FR-SR-02 | View full provider details in structured layout. | H | FR | Profile page shows experience, services & prices, score, remarks, distance. |
| FR-SR-03 | Service-first search. | H | v2.0 | Entry point is service → address → providers. |
| FR-SR-04 | Structured location; distance on every result. | H | v2.0 | Distance computed server-side (PostGIS), shown in km, 1 dp. |
| FR-SR-05 | Extra filters: price range, available today, verified docs, min completed jobs. | M | v2.0 | As FR-SR-01. |
| FR-SR-06 | Weighted ranking (rating, distance, completion rate, response speed, recency); weights configurable; blocked/unapproved never shown. | H | v2.0 | Changing weights reorders fixture results deterministically; suspended/blocked/debt-blocked providers absent. |
| FR-SR-07 | Auto-assign down the ranked list. | M | v2.0 | Offers sent sequentially; first acceptance wins; others cancelled. |

### 7.5 M5 — Booking & Scheduling
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-BK-01 | Book by date, time, service type. | H | FR | Booking created with all three. |
| FR-BK-02 | Only free slots; confirming locks against double booking. | H | v2.0 | Two concurrent confirms for one slot → exactly one succeeds (DB exclusion constraint). |
| FR-BK-03 | Problem text + up to 5 photos. | M | v2.0 | 6th photo rejected. |
| FR-BK-04 | Summary shows estimate, visit fee, surcharge, outstanding fees, cancellation policy before confirm. | H | v2.0 | Confirm disabled until summary rendered. |
| FR-BK-05 | One free reschedule up to 4 h before. | M | v2.0 | Second reschedule or inside 4 h → blocked. |
| FR-BK-06 | Cancel with automatic fee rules. | H | v2.0 | Inside 4 h: fee posted (online: from escrow; cash: receivable). |
| FR-BK-07 | In-app messaging for the booking life with number masking. | M | v2.0 | No phone numbers in any payload; messages disabled 7 days after `CLOSED`. |
| FR-BK-08 | Every state change in status history. | H | v2.0 | History row count = number of transitions (property test). |
| FR-BK-09 | Online bookings paid at checkout; `PENDING_PAYMENT` until captured (CL-07). | H | v2.1 | Provider never sees an unpaid online booking. |
| FR-BK-10 | Unfulfilled bookings refunded (CL-05). | H | v2.1 | After `BR-06` offers/`BR-07` min → `UNFULFILLED` + refund posting. |

### 7.6 M6 — Work Execution & Evidence
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-EX-01 | Mark en route; notify customer. | M | v2.0 | Customer notification logged. |
| FR-EX-02 | Work begins only with start OTP from customer's phone. | H | v2.0 | Wrong OTP 5× → locked 15 min; OTP valid only on slot day. |
| FR-EX-03 | Before/after photos with server timestamps. | H | v2.0 | At least 1 before at start, 1 after at completion. |
| FR-EX-04 | Parts logged with qty & cost as invoice lines. | M | v2.0 | Appear as `PART` lines. |
| FR-EX-05 | Extra work needs in-app approved revised quote. | H | v2.0 | Without approval, extra lines cannot be added. |
| FR-EX-06 | Itemised invoice: service, extras, parts, surcharge, discount, total. | H | v2.0 | Invoice total = Σ lines; PDF downloadable. |
| FR-EX-07 | Configurable warranty; claim reopens as rework. | M | v2.0 | T25 only within `warranty_days`. |
| FR-EX-08 | Service checklist before completion. | H | v2.0 | See FR-CAT-08. |
| FR-EX-09 | Geofenced check-in/out; shortfall flagged. | M | v2.0 | Check-in > `BR-09` m from address → anomaly; time < `BR-23` × expected → anomaly. |
| FR-EX-10 | `final_amount ≤ approved_total`; excess escrow refunded at release (CL-11). | H | v2.1 | Completion with higher amount → 422. |
| FR-EX-11 | Inspection-first rejection completes with visit fee (CL-13). | M | v2.1 | Final = visit fee. |
| FR-EX-12 | Evidence uploads resumable/retryable on 3G; captured offline and queued. | H | v2.1 | Kill network mid-upload → upload completes on reconnect without duplication. |

### 7.7 M7 — Verification & Feedback
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-VC-01 | Completion enqueues and freezes funds. | H | v2.0 | No release/refund posting possible while `AWAITING_VERIFICATION`. |
| FR-VC-02 | Queue ordered by priority then waiting time; SLA countdown; breaches on dashboard. | H | v2.0 | Cash jobs first; breach counter increments at SLA+0. |
| FR-VC-03 | Single-screen console. | H | v2.0 | Booking, invoice, photos, provider history, questionnaire on one route. |
| FR-VC-04 | Fixed questionnaire only. | H | v2.0 | Submission without all mandatory answers → 422. |
| FR-VC-05 | Four agent outcomes. | H | v2.0 | Enum enforced; §5.4 guard rules enforced. |
| FR-VC-06 | Attempts logged; 3 failures across 2 bands → link fallback. | H | v2.0 | Link sent exactly once. |
| FR-VC-07 | 72 h no response → auto-release, rating suppressed. | H | v2.0 | No `ratings` row created. |
| FR-VC-08 | Immutable record; amendments as linked rows. | H | v2.0 | `UPDATE` on submitted row fails at DB level. |
| FR-VC-09 | Recording after spoken consent; retention; admin/finance only. | M | v2.0 | Agent cannot replay recordings of others; purge job deletes after `BR-55` days. |
| FR-VC-10 | No verification of linked parties (CL-19). | H | v2.0 | Console returns 403 `CONFLICT_OF_INTEREST`. |
| FR-VC-11 | Tier routing per §5.2; tier + reasons stored. | H | v2.0 | Unit tests per rule. |
| FR-VC-12 | Tier B no response 24 h → Tier A. | H | v2.0 | Scheduler escalates. |
| FR-VC-13 | Cash jobs priority, 15-min SLA (CL-08). | H | v2.1 | Queue ordering test. |
| FR-VC-14 | SLA counted only in calling hours (CL-20). | H | v2.1 | Completion 21:50 → deadline next day 08:20. |
| FR-VC-15 | A queue item is locked to one agent at a time; lock auto-expires after `BR-26` min idle. | H | v2.1 | Two agents cannot open the same call. |

### 7.8 M8 — Payments, Escrow & Payouts
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-PY-01 | Cash on the spot or transfer to provider. | H | FR | Both selectable at checkout as `CASH`. |
| FR-PY-02 | Online payment via gateway into escrow. | H | v2.0 | Capture posts `GATEWAY_CLEARING → ESCROW`. |
| FR-PY-03 | Escrow releases only on passing outcome or auto-release. | H | v2.0 | Release API rejects any other state. |
| FR-PY-04 | Cash: reversed sequence; commission debited from wallet. | H | v2.0 | Wallet negative by commission after cash confirm. |
| FR-PY-05 | Commission debt > ceiling blocks new offers. | H | v2.0 | Provider excluded from offers/search until cleared. |
| FR-PY-06 | Double-entry ledger for every movement; derived balances. | H | v2.0 | Σ debits = Σ credits per transaction (DB trigger). |
| FR-PY-07 | Refunds to original method with reason. | H | v2.0 | Gateway refund call + ledger posting linked. |
| FR-PY-08 | Payout cycle, batch file, statements. | H | v2.0 | CSV batch + per-provider PDF statement. |
| FR-PY-09 | Idempotent payment operations. | H | v2.0 | Replaying a webhook 10× → one posting. |
| FR-PY-10 | Coupons/referrals funded from commission. | L | v2.0 | Provider share unchanged by coupon. |
| FR-PY-11 | Cash customer cancellation fees → receivable on next booking (CL-21). | M | v2.1 | Next summary shows outstanding fee. |
| FR-PY-12 | Top-up payment for approved revisions on online jobs (CL-11). | H | v2.1 | Work cannot resume until top-up captured. |
| FR-PY-13 | Providers can clear commission debt online. | M | v2.1 | Payment posts to wallet; offers resume. |

### 7.9 M9 — Ratings & Reputation
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-RT-01 | Customer rates after completion (via verification). | H | FR | Rating exists after verified outcome. |
| FR-RT-02 | Customer remarks after completion (via verification). | H | FR | Remark published on release. |
| FR-RT-03 | Ratings only from verification; no in-app rating form. | H | v2.0 | Insert into `ratings` without verification FK fails at DB. |
| FR-RT-04 | Score weighted to recent 20 (CL-17). | M | v2.0 | Fixture calculation matches. |
| FR-RT-05 | Show score, job count, distribution. | M | v2.0 | UI test. |
| FR-RT-06 | First name + initial only. | M | v2.0 | API never returns customer full name to provider. |
| FR-RT-07 | Admin can unpublish abusive remark; rating stays; logged. | M | v2.0 | Score unchanged; audit row exists. |

### 7.10 M10 — Complaints & Disputes
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-CP-01 | Customer complains to admin about provider. | H | FR | Complaint created linked to booking. |
| FR-CP-02 | Admin views complaints, takes action. | H | FR | Queue + resolution. |
| FR-CP-03 | States `OPEN → UNDER_REVIEW → AWAITING_RESPONSE → RESOLVED / REJECTED`; SLA by severity. | H | v2.0 | Illegal state move rejected; SLA breach flagged. |
| FR-CP-04 | Attached to booking, with photos; visible to that booking's agent. | M | v2.0 | Console shows open complaints. |
| FR-CP-05 | Right of reply before penalty. | H | v2.0 | Penalty confirm disabled until reply received or 48 h passed. |
| FR-CP-06 | Outcomes: no action, warning, partial refund, full refund, penalty, suspension, block. | H | v2.0 | Enum. |
| FR-CP-07 | Providers can complain about customers. | M | v2.0 | Reverse complaint type. |
| FR-CP-08 | Safety complaints jump to top. | H | v2.0 | Sorted first; admin alerted immediately. |

### 7.11 M11 — Notifications
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-NT-01 | Email/SMS/in-app on every booking state change (per template matrix). | H | v2.0 | Every transition emits an outbox event. |
| FR-NT-02 | Provider alerts: offer+countdown, acceptance, reminder, payment release. | H | v2.0 | |
| FR-NT-03 | Customer alerts: confirmation, en route, start OTP, completed, pending call, release. | H | v2.0 | |
| FR-NT-04 | Admin alerts: pending approval, SLA breach, dispute, safety complaint. | M | v2.0 | |
| FR-NT-05 | Log channel, recipient, template, delivery status. | M | v2.0 | Status updated from provider callbacks. |
| FR-NT-06 | Templates editable per event × channel × language. | M | v2.1 | Urdu template used when user locale = ur. |

### 7.12 M12 — Administration & Operations
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-AD-01 | Admin login. | H | FR | Staff login requires TOTP 2FA (NFR-SE-07). |
| FR-AD-02 | Approve providers. | H | FR | |
| FR-AD-03 | Manage providers (add/view/update/deactivate). | H | FR | |
| FR-AD-04 | Update provider details; manage passwords. | H | FR | Admin triggers reset link — never sees or sets a plain password. |
| FR-AD-05 | Manage customers. | H | FR | |
| FR-AD-06 | View ratings and averages per provider. | H | FR | |
| FR-AD-07 | View remarks per provider. | H | FR | |
| FR-AD-08 | Block provider for continuous poor rating. | H | FR | Block reason required; provider notified. |
| FR-AD-09 | Soft deactivation only. | H | v2.0 | No DELETE endpoint exists for users. |
| FR-AD-10 | Approval requires document check; decision + reason recorded; rejection notifies. | H | v2.0 | |
| FR-AD-11 | Auto-flag low rolling average (CL-18). | M | v2.0 | |
| FR-AD-12 | Operations board. | M | v2.0 | Live counts equal DB queries. |
| FR-AD-13 | Roles & permissions for agent, finance, admin. | H | v2.0 | Server-side guard matrix test. |
| FR-AD-14 | Append-only audit log, filterable. | H | v2.0 | UPDATE/DELETE fails at DB. |
| FR-AD-15 | Settings UI for all Section 13 values. | H | v2.0 | Change takes effect without deploy; change audited. |
| FR-AD-16 | Staff conflict declarations (CL-19). | M | v2.1 | |

### 7.13 M13 — Maintenance Plans
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-MP-01 | Admin defines plans (services, visit count, interval, price). | M | v2.0 | |
| FR-MP-02 | Visits auto-scheduled; offered first to same provider. | M | v2.0 | Previous provider receives first offer. |
| FR-MP-03 | Same verification flow; release draws on plan balance. | M | v2.0 | Plan payment sits in `PLAN_DEFERRED` account; each verified visit releases its share. |
| FR-MP-04 | View entitlements, renewal; cancel plan. | M | v2.0 | Cancellation refunds unused visits pro-rata. |

### 7.14 M14 — Reporting
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-RP-01 | Monthly bookings and successful handling. | H | FR | |
| FR-RP-02 | Successful = `VERIFIED` or `AUTO_RELEASED` without subsequent dispute. | H | v2.0 | Fixture month reconciles. |
| FR-RP-03 | Revenue report by month/category. | H | v2.0 | Ties to ledger totals. |
| FR-RP-04 | Provider performance report. | M | v2.0 | |
| FR-RP-05 | Verification report. | M | v2.0 | |
| FR-RP-06 | Export PDF & Excel; printable. | M | v2.0 | Generated async; download link. |

### 7.15 M15 — Conduct & Penalties
| ID | Requirement | P | Src | Acceptance criterion |
|---|---|---|---|---|
| FR-PN-01 | Demerits for verified breaches per schedule (§8.2). | H | v2.0 | |
| FR-PN-02 | Expiry 180 d + decay (CL-15). | H | v2.0 | Time-travel test. |
| FR-PN-03 | Thresholds fire automatically (CL-16). | H | v2.0 | |
| FR-PN-04 | Fines debited from wallet; shortfall = debt blocking offers. | H | v2.0 | |
| FR-PN-05 | Per-job liability cap = job value + max fine. | H | v2.0 | Excess fine truncated to cap. |
| FR-PN-06 | Evidence shown + 48 h to respond before any penalty. | H | v2.0 | Penalty state `PROPOSED` → `APPLIED` only after reply/48 h. |
| FR-PN-07 | Appeals recorded in audit log. | M | v2.0 | Reversal posts compensating ledger entries and removes points. |
| FR-PN-08 | Schedule shown at registration and in conduct record. | H | v2.0 | Provider must accept it (recorded) before submitting for approval. |
| FR-PN-09 | Top-tier incentives. | L | v2.0 | Reduced commission applied via provider commission rule. |
| FR-PN-10 | Breach categories; harsher consequence wins (CL-14). | H | v2.1 | |

---

## 8. Conduct and Penalty Framework

### 8.1 Principles
1. Penalties follow verified evidence, never a single unsupported complaint.
2. Integrity breaches are separated from quality shortfalls.
3. No penalty without a 48 h right of reply.
4. Penalties are bounded per job.
5. The framework is published and acknowledged at registration.

### 8.2 Demerit schedule
| Code | Breach | Category | Points | Financial consequence |
|---|---|---|---|---|
| LATE_30 | Late > 30 min without notice | RELIABILITY | 1 | — |
| LATE_CANCEL | Cancellation inside 4 h | RELIABILITY | 3 | Cancellation fee |
| REWORK_VERIFIED | Rework required, verified | QUALITY | 4 | Rework at own cost |
| POOR_STREAK | 3 consecutive jobs < 3.0 | QUALITY | 5 | Ranking demotion |
| NO_SHOW | No-show | RELIABILITY | 8 | Full refund + fixed penalty |
| REWORK_FAILED_2 | Second failed rework | QUALITY | 8 | Partial/full refund |
| SUBSTITUTE | Unregistered substitute | INTEGRITY | 20 | Suspension |
| OFF_PLATFORM | Taking customer off-platform | INTEGRITY | 20 | Commission recovery + suspension |
| OVERCHARGE | Charging beyond approved quote | INTEGRITY | 25 | Refund excess + fine 2× excess; **block** (CL-14) |
| FALSIFIED | Falsified completion | INTEGRITY | 25 | Full refund; **block** (CL-14) |
| UNSAFE | Unsafe work damaging property | SAFETY | 25 | Damage recovery + suspension |
| HARASSMENT | Misbehaviour/harassment, verified | CONDUCT | 30 | Permanent block |
| FAKE_RATINGS | Fabricated ratings/collusion | INTEGRITY | 30 | Block; wallet forfeited |

### 8.3 Thresholds (active points)
10 → written warning · 20 → ranking demotion 30 d · 30 → 7-day suspension · 45 → 30-day suspension + document re-verification · 60, or any single `INTEGRITY` breach ≥ 25 → permanent block.

### 8.4 Counterweights
Visible decay progress · top-tier priority offers, reduced commission, faster payouts · badges feed ranking · every penalty appealable.

---

## 9. Use Cases
Index UC-01…UC-17 as SRS v2.0 §8.2. Detailed flows for UC-05, UC-10, UC-12, UC-14 carry forward from v2.0 with these v2.1 amendments:
- **UC-05** step 7: online → `PENDING_PAYMENT` → gateway → `REQUESTED`; cash → `REQUESTED` directly. Exception 7b uses the DB exclusion constraint.
- **UC-10** step 1: agent *claims* the item (lock, FR-VC-15). Step 4: console enforces §5.4 guard rules. Postcondition: `verification_calls.status = SUBMITTED`.
- **UC-12** step 3: cash jobs → "authorised to collect" (CL-09).
- **UC-14** step 3: resolution posts ledger entries in one transaction; penalty follows FR-PN-06.

Additional detailed use case:

**UC-18 — Cash job settlement.** *Actor:* provider. *Pre:* booking `VERIFIED` or `AUTO_RELEASED`, `payment_mode=CASH`. *Flow:* 1. App shows "Collect PKR X". 2. Provider collects cash or receives transfer. 3. Provider taps "Payment received", selects method. 4. System posts commission to wallet, moves booking to `PAYMENT_RELEASED`, sends customer SMS receipt with problem link. *Exception:* customer reports non-payment/overpayment via link → complaint opens, linked to booking. *Requirements:* FR-PY-04, FR-PY-05, CL-08, CL-09.

---

## 10. External Interfaces
**Screens** — as v2.0 §9.1 (public, customer, provider, agent, finance, admin); full route map in TRD §15.
**Hardware** — provider camera and geolocation; agent headset/softphone.
**Software** — payment gateway, SMS, email, maps/geocoding, telephony, WhatsApp (optional); each behind an adapter with a mock (TRD §17).
**Communication** — HTTPS only; HMAC-verified webhooks; notifications and reports via async queue.

---

## 11. Data Requirements
The complete logical and physical model is in `03_ERD.md` and `04_schema.sql`. Integrity rules enforced **in the database**:
1. `ratings.verification_call_id` NOT NULL, FK, UNIQUE; the referenced record must have a rating-producing outcome (trigger).
2. `bookings` cannot enter `WORK_COMPLETED` unless `start_otp_verified_at` is set (CHECK).
3. `bookings` cannot enter `PAYMENT_RELEASED` unless a release-permitting verification exists or auto-release applies (trigger).
4. Every ledger transaction balances (deferred constraint trigger).
5. No hard delete on users participating in bookings (FK `ON DELETE RESTRICT` + no delete grant).
6. `audit_log`, `verification_calls` (after submit), `ledger_entries`, `booking_status_history` are insert-only (triggers).
7. No overlapping active bookings per provider (`EXCLUDE USING gist`).

---

## 12. Non-Functional Requirements
| ID | Requirement | Measure |
|---|---|---|
| NFR-SE-01 | Argon2id password hashing | Params m=19 MiB, t=2, p=1 minimum |
| NFR-SE-02 | Server-side RBAC on every request | Guard matrix test covers 100 % of routes |
| NFR-SE-03 | Parameterised queries only | Lint rule bans string-built SQL |
| NFR-SE-04 | CSRF protection + output escaping | SameSite=Lax cookies + CSRF token on mutations |
| NFR-SE-05 | Upload type/size limits; stored outside web root | Images ≤ 8 MB, JPEG/PNG/WebP/HEIC; docs ≤ 10 MB PDF/JPEG; private bucket |
| NFR-SE-06 | Rate-limit login and OTP | 5/15 min per identifier; 20/15 min per IP |
| NFR-SE-07 | Staff 2FA (TOTP) | *v2.1* |
| NFR-SE-08 | Secrets never in repo; env-validated at boot | *v2.1* |
| NFR-PR-01 | Phone masking between parties | |
| NFR-PR-02 | Recordings encrypted at rest; retention; role-restricted | |
| NFR-PR-03 | Identity documents visible only to approving admin | Signed URLs, 5-min TTL, access audited |
| NFR-PR-04 | Remarks under first name + initial | |
| NFR-IN-01 | Money ops in DB transactions | |
| NFR-IN-02 | Idempotent callbacks | |
| NFR-IN-03 | Append-only audit log | |
| NFR-IN-04 | Daily backups + documented restore; PITR | RPO ≤ 15 min, RTO ≤ 4 h |
| NFR-PE-01 | Search ≤ 2 s at 10 000 providers | p95 ≤ 800 ms target, 2 s hard limit |
| NFR-PE-02 | Indexes on city, area, service, status, rating | + GiST on geography |
| NFR-PE-03 | Notifications and reports async | |
| NFR-PE-04 | Provider UI usable on 3G; resumable uploads | Provider pages ≤ 200 KB JS initial; images compressed client-side to ≤ 1600 px |
| NFR-PE-05 | API p95 ≤ 400 ms for non-search endpoints | *v2.1* |
| NFR-US-01 | Mobile-first, usable at 360 px | |
| NFR-US-02 | English + Urdu with RTL | |
| NFR-US-03 | Field errors as text | |
| NFR-US-04 | Visible keyboard focus | WCAG 2.2 AA target |
| NFR-MA-01 | All values in config, admin-editable | |
| NFR-MA-02 | Seed data | |
| NFR-MA-03 | Structured logging without sensitive data | PII redaction list enforced |
| NFR-MA-04 | Automated test coverage ≥ 80 % on domain modules; 100 % of state transitions | *v2.1* |
| NFR-AV-01 | Availability 99.5 % monthly | *v2.1* |

---

## 13. Configuration Catalogue (defaults — placeholders pending OQ-05)
| ID | Key | Default |
|---|---|---|
| BR-01 | `booking.offer_timeout_min` | 15 |
| BR-02 | `booking.free_cancel_hours` | 4 |
| BR-03 | `booking.late_cancel_fee` | PKR 500 |
| BR-04 | `booking.no_show_grace_min` | 30 |
| BR-05 | `booking.pending_payment_timeout_min` | 15 |
| BR-06 | `booking.max_offers` | 5 |
| BR-07 | `booking.max_offer_window_min` | 60 |
| BR-08 | `booking.travel_buffer_min` | 30 |
| BR-09 | `evidence.geofence_radius_m` | 200 |
| BR-10 | `booking.max_free_reschedules` | 1 |
| BR-11 | `verification.sla_min` | 30 |
| BR-12 | `verification.cash_sla_min` | 15 |
| BR-13 | `verification.calling_hours` | 08:00–22:00 PKT |
| BR-14 | `verification.time_bands` | 08–12, 12–17, 17–22 |
| BR-15 | `verification.max_attempts` | 3 in 24 h |
| BR-16 | `verification.auto_release_hours` | 72 |
| BR-17 | `verification.post_release_complaint_days` | 7 |
| BR-20 | `tier.first_jobs` | 5 |
| BR-21 | `tier.value_threshold` | PKR 15 000 |
| BR-22 | `tier.sample_rate` | 0.10 |
| BR-23 | `tier.min_time_ratio` | 0.40 |
| BR-24 | `tier.b_escalation_hours` | 24 |
| BR-25 | `verification.force_tier_a` | **true** |
| BR-26 | `verification.lock_timeout_min` | 10 |
| BR-30 | `rework.window_hours` | 48 |
| BR-31 | `flags.window_days` / `flags.review_count` | 90 / 3 |
| BR-32 | `provider.cancel_review` | 3 in 30 days |
| BR-35 | `commission.default_pct` | 15 % |
| BR-36 | `emergency.surcharge_pct` | 25 % |
| BR-37 | `cash.debt_ceiling` | PKR 5 000 |
| BR-40 | `rating.recent_weight` (last 20) | 2 |
| BR-41 | `rating.poor_threshold` / window | 3.0 / 10 jobs |
| BR-45 | `demerit.expiry_days` / `decay_days` | 180 / 30 |
| BR-46 | `penalty.reply_hours` | 48 |
| BR-47 | `penalty.max_fine` | PKR 10 000 |
| BR-48 | `penalty.no_show_fine` | PKR 1 000 |
| BR-50 | `payout.cycle` | Weekly, Monday 10:00 |
| BR-51 | `payout.min_amount` | PKR 1 000 |
| BR-55 | `recording.retention_days` | 180 |
| BR-56 | `complaint.sla_hours` | SAFETY 1 · HIGH 24 · NORMAL 72 |
| BR-60 | `ranking.weights` | rating .35 · distance .25 · completion .20 · response .10 · recency .10 |

---

## 14. Implementation Phases (summary; detail in TRD §23)
| Phase | Modules | Exit demo |
|---|---|---|
| 0 Foundation infra | — | Monorepo, CI, Docker, DB migrated, auth skeleton |
| 1 Onboarding | M1, M2, M3, M12 (core) | Admin approves a real provider |
| 2 Transacting | M4, M5, M6 | Job runs to completion |
| 3 Verification & money | M7, M8, M9 | Money moves correctly; ratings from calls only |
| 4 Trust & comms | M10, M11, M15 | Dispute + penalty + appeal end to end |
| 5 Depth | M13, M14, ops board | Plans, reports, exports |

---

## Appendix A — Traceability to FR.pdf
All 24 FR.pdf requirements map exactly as in SRS v2.0 Appendix A (FR-SP-01…05, FR-CU-01…02, FR-SR-01…02, FR-BK-01, FR-RT-01…02, FR-CP-01…02, FR-AD-01…08, FR-RP-01…02, FR-PY-01, FR-VC-01…12). None has been dropped or renumbered in v2.1.

## Appendix B — v2.1 delta summary
- 25 clarifications (CL-01…CL-25), 6 open questions.
- New states: `PENDING_PAYMENT`, `ABANDONED`, `UNFULFILLED`, `REWORK_REQUIRED`, `QUOTE_REVISION` (formalised).
- New requirements: FR-CAT-08, FR-BK-09/10, FR-EX-10/11/12, FR-VC-13/14/15, FR-PY-11/12/13, FR-NT-06, FR-AD-16, FR-PN-10, NFR-SE-07/08, NFR-PE-05, NFR-MA-04, NFR-AV-01.
- Money in paisa; escrow on ledger; complete transition table T1–T26; acceptance criteria for every requirement.
