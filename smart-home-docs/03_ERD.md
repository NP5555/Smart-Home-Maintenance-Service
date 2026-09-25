# Entity-Relationship Design (ERD) — Smart Home Maintenance Services

| Field | Detail |
|---|---|
| Version | 1.0 |
| Physical schema | `04_schema.sql` (PostgreSQL 16 + PostGIS) — **the source of truth**; this document explains it |
| Tables | 72 tables, 3 views, 52 enum types |

Diagrams are split by domain for readability (Mermaid renders on GitHub, GitLab, Cursor preview and most Markdown viewers). Only keys and the most significant columns are drawn; `04_schema.sql` has every column, type and constraint.

---

## 1. Domain Map

```mermaid
flowchart TB
  ID[Identity<br/>users, roles, sessions, otp] --> CU[Customers & addresses]
  ID --> PR[Providers<br/>docs, services, areas, availability]
  CAT[Catalogue<br/>categories, services, checklists, commission] --> PR
  PL[Place<br/>cities, areas] --> CU & PR
  CU & PR & CAT --> BK[Bookings<br/>offers, history, messages]
  BK --> EX[Execution<br/>evidence, checklist, revisions, items, invoice]
  BK --> VF[Verification<br/>calls, attempts, links, amendments]
  VF --> RT[Ratings & remarks]
  BK --> MO[Money<br/>payments, ledger, refunds, payouts]
  BK --> TR[Trust<br/>complaints, disputes]
  TR --> CD[Conduct<br/>penalties, demerits, appeals, flags]
  CD --> MO
  CU --> PLN[Plans<br/>subscriptions, visits] --> BK
  ALL[Platform<br/>outbox, notifications, settings, audit, reports]
```

---

## 2. Identity, Place, Customers & Providers

```mermaid
erDiagram
  users ||--o{ user_roles : has
  roles ||--o{ user_roles : grants
  roles ||--o{ role_permissions : has
  permissions ||--o{ role_permissions : in
  users ||--o{ sessions : owns
  users ||--o{ otp_codes : receives
  users ||--o| customers : "is a"
  users ||--o| providers : "is a"
  cities ||--o{ areas : contains
  customers ||--o{ addresses : saves
  areas ||--o{ addresses : locates
  customers ||--o{ favourites : marks
  providers ||--o{ favourites : "marked in"
  providers ||--o{ provider_documents : uploads
  providers ||--o{ provider_services : offers
  services ||--o{ provider_services : "offered as"
  providers ||--o{ provider_service_areas : covers
  areas ||--o{ provider_service_areas : "covered by"
  providers ||--o{ provider_availability : "works"
  providers ||--o{ provider_time_off : "takes"
  providers ||--o{ provider_payout_accounts : "paid to"
  providers ||--|| provider_stats : "summarised by"
  cities ||--o{ providers : "based in"

  users {
    uuid id PK
    text phone_e164 UK
    citext email UK
    text password_hash
    user_status status
    timestamptz phone_verified_at
    bytea totp_secret_enc
  }
  providers {
    uuid user_id PK,FK
    provider_status status
    geography base_location
    int radius_m
    text cnic_hash UK
    timestamptz suspended_until
    text offer_blocked_reason
  }
  provider_services {
    uuid provider_id PK,FK
    int service_id PK,FK
    approval_status status
    bigint price_paisa
  }
  provider_availability {
    uuid id PK
    smallint weekday
    time start_time
    time end_time
  }
  provider_time_off {
    uuid id PK
    tstzrange period "EXCLUDE overlap"
  }
  addresses {
    uuid id PK
    uuid customer_id FK
    int area_id FK
    geography location
    timestamptz archived_at
  }
  provider_stats {
    uuid provider_id PK,FK
    numeric rating_score
    int rating_count
    numeric completion_rate
    int active_demerits
  }
```

---

## 3. Catalogue & Plans

```mermaid
erDiagram
  categories ||--o{ services : groups
  services ||--o{ service_checklist_items : "defines steps"
  categories ||--o{ commission_rules : "category rate"
  providers ||--o{ commission_rules : "provider rate"
  plans ||--o{ plan_services : includes
  services ||--o{ plan_services : "included in"
  customers ||--o{ subscriptions : buys
  plans ||--o{ subscriptions : "sold as"
  subscriptions ||--o{ plan_visits : entitles
  plan_visits |o--o| bookings : "realised by"

  services {
    int id PK
    int category_id FK
    pricing_model pricing_model
    time_unit time_unit
    bigint base_price_paisa
    bigint min_price_paisa
    bigint max_price_paisa
    bigint visit_fee_paisa
    int expected_duration_min
    bool is_emergency_eligible
    bool is_plan_eligible
    int warranty_days
    bool is_high_risk
  }
  service_checklist_items {
    int id PK
    int service_id FK
    int position
    bool requires_photo
  }
  commission_rules {
    uuid id PK
    commission_scope scope
    int rate_bp
    timestamptz effective_from
  }
  subscriptions {
    uuid id PK
    subscription_status status
    uuid preferred_provider_id FK
    timestamptz ends_at
  }
  plan_visits {
    uuid id PK
    date due_date
    bigint value_paisa
    plan_visit_status status
  }
```

---

## 4. Bookings & Execution

```mermaid
erDiagram
  customers ||--o{ bookings : places
  providers |o--o{ bookings : performs
  services ||--o{ bookings : "booked as"
  addresses ||--o{ bookings : "at"
  subscriptions |o--o{ bookings : "plan visit"
  coupons |o--o{ bookings : discounts
  bookings ||--o{ booking_offers : "offered via"
  providers ||--o{ booking_offers : receives
  bookings ||--o{ booking_status_history : "audited by"
  bookings ||--o{ messages : "chat"
  bookings ||--o{ job_evidence : "evidenced by"
  bookings ||--o{ job_checklist_results : "checked by"
  service_checklist_items ||--o{ job_checklist_results : "item"
  bookings ||--o{ quote_revisions : "revised by"
  quote_revisions |o--o| payments : "top-up"
  bookings ||--o{ booking_items : "itemised as"
  quote_revisions |o--o{ booking_items : adds
  bookings ||--o| invoices : "billed by"
  bookings ||--o| coupon_redemptions : redeems

  bookings {
    uuid id PK
    text code UK
    uuid customer_id FK
    uuid provider_id FK "null during auto-assign"
    booking_status status
    payment_mode payment_mode
    booking_payment_status payment_status
    tstzrange slot "EXCLUDE per provider"
    bigint quoted_amount_paisa
    bigint approved_total_paisa
    bigint final_amount_paisa "<= approved_total"
    int commission_rate_bp "snapshot"
    timestamptz start_otp_verified_at
    int checkin_distance_m
    verification_tier verification_tier
    smallint visit_no
    smallint failed_rework_count
    int version
  }
  booking_offers {
    uuid id PK
    smallint rank
    offer_status status "one PENDING per booking"
    timestamptz expires_at
  }
  booking_status_history {
    bigint id PK
    booking_status from_status
    booking_status to_status
    text event
    actor_role actor_role
    jsonb metadata
  }
  job_evidence {
    uuid id PK
    evidence_kind kind
    smallint visit_no
    uuid client_uuid "dedupe"
    timestamptz received_at "authoritative"
    geography location
  }
  quote_revisions {
    uuid id PK
    revision_status status "one PENDING per booking"
    bigint delta_paisa
  }
  booking_items {
    uuid id PK
    item_kind kind
    numeric quantity
    bigint amount_paisa
  }
  invoices {
    uuid id PK
    text number UK
    bigint total_paisa
  }
```

---

## 5. Verification & Reputation

```mermaid
erDiagram
  bookings ||--o{ verification_calls : "one per visit"
  verification_calls ||--o{ verification_call_attempts : "attempted via"
  verification_calls ||--o{ verification_links : "fallback link"
  verification_calls ||--o{ verification_amendments : "amended by"
  users ||--o{ staff_conflicts : declares
  verification_calls ||--o| ratings : "produces (only source)"
  ratings ||--o| remarks : "has"
  remarks ||--o| remark_replies : "answered by"
  providers ||--o{ ratings : "rated in"

  verification_calls {
    uuid id PK
    uuid booking_id FK
    smallint visit_no "UK with booking_id"
    verification_tier tier
    text_array routing_reasons
    smallint priority "0 cash"
    verification_status status "QUEUED LOCKED SUBMITTED"
    timestamptz sla_due_at
    uuid locked_by FK
    verification_outcome outcome
    work_completion work_completed
    smallint quality
    smallint punctuality
    smallint conduct
    smallint cleanliness
    bool extra_charge_demanded
    bool consent_to_release
    text remark_text
    timestamptz submitted_at "immutable after"
  }
  verification_call_attempts {
    uuid id PK
    smallint attempt_no
    time_band band
    attempt_result result
    text recording_ref
  }
  verification_links {
    uuid id PK
    text token_hash UK
    timestamptz expires_at
    jsonb answers
  }
  ratings {
    uuid id PK
    uuid verification_call_id FK,UK "NOT NULL"
    numeric score "generated"
  }
  remarks {
    uuid id PK
    text display_name "first name + initial"
    bool is_published
  }
```

---

## 6. Money

```mermaid
erDiagram
  bookings ||--o{ payments : "paid by"
  subscriptions ||--o{ payments : "plan payment"
  payments ||--o{ payment_events : "webhooks"
  payments ||--o{ refunds : "refunded by"
  ledger_transactions ||--|{ ledger_entries : "2+ balanced lines"
  ledger_accounts ||--o{ ledger_entries : posts
  ledger_accounts ||--|| account_balances : "derived balance"
  ledger_transactions |o--o| ledger_transactions : reverses
  bookings |o--o{ ledger_accounts : "ESCROW dimension"
  users |o--o{ ledger_accounts : "wallet/receivable owner"
  refunds |o--o| ledger_transactions : posted
  providers ||--o{ payouts : requests
  provider_payout_accounts ||--o{ payouts : "paid to"
  payout_batches ||--o{ payouts : groups
  payouts |o--o| ledger_transactions : posted
  coupons ||--o{ coupon_redemptions : "redeemed"

  payments {
    uuid id PK
    payment_purpose purpose
    text gateway_ref "UK with gateway"
    bigint amount_paisa
    payment_status status
    text idempotency_key UK
  }
  payment_events {
    uuid id PK
    text gateway_event_id "UK with gateway"
    jsonb payload
  }
  ledger_accounts {
    uuid id PK
    account_type type
    uuid owner_user_id FK
    uuid booking_id FK
  }
  ledger_transactions {
    uuid id PK
    ledger_tx_type type
    text idempotency_key UK
    uuid reverses_transaction_id FK
  }
  ledger_entries {
    bigint id PK
    entry_direction direction
    bigint amount_paisa "> 0"
  }
  account_balances {
    uuid account_id PK,FK
    bigint debit_total
    bigint credit_total
    bigint balance "generated"
  }
  payouts {
    uuid id PK
    bigint amount_paisa
    payout_status status
  }
```

---

## 7. Trust & Conduct

```mermaid
erDiagram
  bookings |o--o{ complaints : "about"
  users ||--o{ complaints : "raised / against"
  complaints ||--o{ complaint_events : "timeline"
  bookings ||--o{ disputes : "at most one open"
  complaints |o--o{ disputes : "escalates"
  breach_types ||--o{ penalties : classifies
  providers ||--o{ penalties : receives
  penalties ||--o| demerit_awards : awards
  penalties ||--o| appeals : "appealed by"
  penalties |o--o{ threshold_events : triggers
  providers ||--o{ provider_flags : flagged
  penalties |o--o| ledger_transactions : "fine posted"

  complaints {
    uuid id PK
    complaint_source source
    complaint_category category
    complaint_severity severity
    complaint_status status
    timestamptz sla_due_at
    complaint_resolution resolution
  }
  disputes {
    uuid id PK
    dispute_origin origin
    dispute_status status
    timestamptz reply_due_at
    dispute_resolution resolution
    bigint release_paisa
    bigint refund_paisa
  }
  breach_types {
    text code PK
    breach_category category
    smallint points
    jsonb fine_rule
  }
  penalties {
    uuid id PK
    penalty_status status
    bigint fine_paisa
    timestamptz reply_due_at
    timestamptz applied_at "CHECK after reply or deadline"
  }
  demerit_awards {
    uuid id PK
    smallint points_awarded
    smallint points_remaining
    timestamptz expires_at
    timestamptz voided_at
  }
  threshold_events {
    uuid id PK
    smallint threshold
    text consequence
  }
```

---

## 8. Platform

```mermaid
erDiagram
  outbox_events ||--o{ notifications : "fans out to"
  notification_templates ||--o{ notifications : renders
  users ||--o{ notifications : receives
  users ||--o{ audit_log : performs
  users ||--o{ idempotency_keys : sends
  users ||--o{ report_runs : requests

  outbox_events {
    bigint id PK
    text type
    jsonb payload
    timestamptz processed_at
  }
  notifications {
    uuid id PK
    notification_channel channel
    notification_status status
    bigint outbox_event_id "UK with user+channel"
  }
  settings {
    text key PK
    jsonb value
  }
  audit_log {
    bigint id PK
    text action
    text entity_type
    jsonb before
    jsonb after
  }
```

---

## 9. Data Dictionary (by table)

Legend: **PK** primary key · **FK** foreign key · **UK** unique · 🔒 insert-only (DB trigger) · ⛔ no physical delete.

### Identity
| Table | Purpose | Key rules |
|---|---|---|
| `users` ⛔ | Every human account (customer, provider, staff). | Phone or email required; deactivation = `status` + anonymisation, never delete. |
| `roles`, `permissions`, `role_permissions`, `user_roles` | RBAC (FR-AD-13). A user may hold several roles (e.g. staff who is also a customer). | Permissions are codes checked by the API policy guard. |
| `sessions` | Refresh-token sessions with rotation families. | Reuse of a rotated token revokes the whole family. |
| `otp_codes` | Registration, login, reset, phone-change codes. | Hashed; 10-min expiry; 5 attempts. |

### Place & Catalogue
| Table | Purpose | Key rules |
|---|---|---|
| `cities`, `areas` | Structured location (FR-SR-04). | Launch = one city; schema multi-city ready. |
| `categories`, `services` | Catalogue (M1). | Price band check; `TIME_BASED` ⇔ `time_unit`; inspection-first ⇒ visit fee > 0. |
| `service_checklist_items` | Ordered completion steps (FR-EX-08). | `requires_photo` enforces evidence. |
| `commission_rules` | Global/category/provider rates in basis points. | Scope-consistency check; resolution done in code; snapshot on booking. |

### Customers & Providers
| Table | Purpose | Key rules |
|---|---|---|
| `customers`, `addresses`, `favourites` | Customer profile (M2). | Addresses archived, never deleted (bookings reference them); one default. |
| `providers` | Provider profile & lifecycle. | CNIC encrypted + blind index UK; `offer_blocked_reason` excludes from offers/search. |
| `provider_documents` | CNIC/cert uploads & review. | Approval blocked until CNIC `VERIFIED`. |
| `provider_services` | Approved expertise + own price (FR-CAT-03/04). | Price-band check in service layer. |
| `provider_service_areas` | Areas served (FR-SP-08). | Combined with radius in search. |
| `provider_availability`, `provider_time_off` | Weekly rules + leave (FR-SP-07). | Time-off ranges cannot overlap (exclusion). |
| `provider_payout_accounts` | Bank/wallet destinations. | Number encrypted; last4 for display. |
| `provider_stats` | Read-model projection for search & dashboards. | Written only by the projections worker. |

### Bookings & Execution
| Table | Purpose | Key rules |
|---|---|---|
| `bookings` ⛔ | The job and its state. | Status changes only via service (trigger); exclusion constraint prevents double booking; `final ≤ approved_total`; post-start states require OTP; release requires verification or dispute resolution (trigger). |
| `booking_offers` | Offer cascade / auto-assign (CL-05). | One pending offer per booking. |
| `booking_status_history` 🔒 | Full transition log (FR-BK-08). | One row per transition. |
| `messages` | Masked in-app chat (FR-BK-07). | No phone numbers exposed. |
| `job_evidence` 🔒 | Photos for problem/before/after/checklist/complaint. | `(booking_id, client_uuid)` UK for offline retry dedupe; server `received_at` authoritative. |
| `job_checklist_results` | Checklist completion per visit. | |
| `quote_revisions` | On-site revised quotes (FR-EX-05). | One pending per booking; top-up payment link. |
| `booking_items` | Invoice lines (service, visit fee, extra, part, surcharge, discount). | Only discounts negative. |
| `invoices` | Issued invoice at completion. | Total arithmetic check. |
| `coupons`, `coupon_redemptions` | Promotions funded from commission (FR-PY-10). | One redemption per booking. |

### Verification & Reputation
| Table | Purpose | Key rules |
|---|---|---|
| `verification_calls` | The verification record (one per completed visit). | Immutable once submitted (trigger); questionnaire completeness and integrity guards as CHECKs; queue index on `(priority, sla_due_at)`. **Deviation from v2.0:** unique on `(booking_id, visit_no)` rather than `booking_id`, because a rework produces a second visit that must be verified while the first record stays immutable. |
| `verification_call_attempts` 🔒 | Each call attempt (FR-VC-06). | |
| `verification_links` | Tier B / fallback one-tap confirmations (v2.0 name: `verification_responses`). | Token and OTP hashed. |
| `verification_amendments` 🔒 | Linked corrections (FR-VC-08). | |
| `staff_conflicts` | Declared conflicts (CL-19). | Also checked: same phone/email/CNIC. |
| `ratings` 🔒 | Published score inputs. | **FK + NOT NULL + trigger** to a rating-producing verification — the single rule that makes every rating trustworthy. |
| `remarks`, `remark_replies` 🔒(replies) | Public remark + one provider reply. | Unpublish keeps rating in score. |

### Money
| Table | Purpose | Key rules |
|---|---|---|
| `payments` | Gateway checkouts (booking, top-up, plan, debt). | Idempotency key UK; `(gateway, gateway_ref)` UK. |
| `payment_events` | Raw webhooks. | `(gateway, gateway_event_id)` UK → replay-safe. |
| `ledger_accounts` | Chart of accounts with owner/booking/subscription dimensions. | `UNIQUE NULLS NOT DISTINCT`. |
| `ledger_transactions` 🔒 | One business posting. | Idempotency key UK; reversals link to original. |
| `ledger_entries` 🔒 | Debit/credit lines. | Deferred trigger: Σ debit = Σ credit, ≥ 2 lines. |
| `account_balances` | Derived balances. | Maintained only by trigger; nightly reconciliation. |
| `refunds` | Refunds to original method. | Linked ledger transaction. |
| `payout_batches`, `payouts` | Provider payouts (FR-PY-08). | |

### Trust & Conduct
| Table | Purpose | Key rules |
|---|---|---|
| `complaints`, `complaint_events` 🔒 | Complaint lifecycle (M10). | Resolved ⇔ `resolved_at`. |
| `disputes` | Money disputes (UC-14). | One open per booking; resolved ⇔ resolution. |
| `breach_types` | Demerit schedule (SRS §8.2), seeded. | Category drives CL-14. |
| `penalties` | Proposed/applied/appealed penalties. | CHECK: applied only after reply or deadline (FR-PN-06). |
| `demerit_awards` | Points with remaining/expiry for decay (CL-15). | Voided on successful appeal. |
| `threshold_events` | Consequences fired on crossings (CL-16). | |
| `appeals` | One appeal per penalty. | |
| `provider_flags` | Issue/low-rating/cancellation/anomaly flags. | 3 in 90 days → review. |

### Platform
| Table | Purpose | Key rules |
|---|---|---|
| `outbox_events` | Transactional outbox. | Processed with `SKIP LOCKED`. |
| `notifications`, `notification_templates` | Delivery log + editable templates (M11). | `(outbox_event_id, user_id, channel)` UK for idempotent fan-out. |
| `idempotency_keys` | Client idempotency for mutations. | |
| `settings` | All configurable values (SRS §13). | Changes audited. |
| `audit_log` 🔒 | Privileged actions (FR-AD-14). | |
| `report_runs` | Async report generation (M14). | |

### Views
`v_provider_wallet` (wallet balance per provider), `v_escrow_by_booking` (held per booking), `v_active_demerits` (active points per provider).

---

## 10. Cardinality & Lifecycle Notes
- **Customer 1 — N Bookings; Provider 0..1 — N Bookings** (null during auto-assign).
- **Booking 1 — N Verification records** (one per visit; normally 1, rework adds more). **Verification 1 — 0..1 Rating** (none for rework/dispute/auto-release).
- **Booking 1 — 0..1 Escrow account**, created lazily on first capture.
- **Provider 1 — 1 Wallet account**, created at approval.
- **Penalty 1 — 0..1 Demerit award**, **0..1 Appeal**, **0..1 Fine posting**.
- Soft-delete tables: `users` (status), `addresses` (`archived_at`), `provider_payout_accounts` (`archived_at`), catalogue (`is_active`).

## 11. Index Summary (NFR-PE-02)
City/area (`providers_city_idx`, `areas_city_idx`, `addresses.area_id`), service (`provider_services_service_idx`, `bookings_service_idx`), booking status (`bookings_status_idx`), rating (`provider_stats_rating_idx`), geography GiST (`providers_location_gix`, `addresses_location_gix`), queue (`verification_queue_idx`), outbox (`outbox_unprocessed_idx`), audit (`audit_log_entity_idx`, `audit_log_actor_idx`).

## 12. Prisma Integration
1. `dbmate up` applies `04_schema.sql` (copied to `packages/db/migrations/0001_init.sql`).
2. `prisma db pull` introspects; `geography` and `tstzrange` columns appear as `Unsupported(...)` — read/write them with `$queryRaw` in dedicated repository functions (`SlotRepository`, `GeoRepository`).
3. `prisma generate` produces the typed client. **Never** run `prisma migrate`; all schema changes are new dbmate SQL files followed by `db pull`.
4. Money columns are `BigInt` in Prisma — convert with the shared `Money` helper; never `Number()` on paisa values above 2^53 (not reachable in practice, but enforced by lint).
