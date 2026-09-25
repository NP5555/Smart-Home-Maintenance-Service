-- =====================================================================
-- Smart Home Maintenance Services — canonical schema (PostgreSQL 16 + PostGIS 3)
-- Source of truth for the data model. Apply as migration 0001 (dbmate),
-- then generate the Prisma client with `prisma db pull && prisma generate`.
-- Money: BIGINT paisa. Time: timestamptz (UTC). IDs: uuid (entities), bigint (logs).
-- =====================================================================

-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
CREATE TYPE user_status        AS ENUM ('ACTIVE','LOCKED','DEACTIVATED');
CREATE TYPE otp_purpose        AS ENUM ('REGISTER','LOGIN','PASSWORD_RESET','PHONE_CHANGE');
CREATE TYPE provider_status    AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','SUSPENDED','BLOCKED','DEACTIVATED');
CREATE TYPE document_type      AS ENUM ('CNIC_FRONT','CNIC_BACK','TRADE_CERT','CHARACTER_CERT');
CREATE TYPE review_status      AS ENUM ('PENDING','VERIFIED','REJECTED');
CREATE TYPE approval_status    AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE pricing_model      AS ENUM ('FLAT','TIME_BASED','INSPECTION_FIRST');
CREATE TYPE time_unit          AS ENUM ('HOUR','DAY');
CREATE TYPE commission_scope   AS ENUM ('GLOBAL','CATEGORY','PROVIDER');
CREATE TYPE payout_account_kind AS ENUM ('BANK','WALLET');

CREATE TYPE booking_status AS ENUM (
  'PENDING_PAYMENT','ABANDONED','REQUESTED','UNFULFILLED','ACCEPTED','SCHEDULED','EN_ROUTE',
  'IN_PROGRESS','QUOTE_REVISION','WORK_COMPLETED','AWAITING_VERIFICATION','REWORK_REQUIRED',
  'VERIFIED','AUTO_RELEASED','DISPUTED','PAYMENT_RELEASED','PARTIALLY_REFUNDED','REFUNDED',
  'CANCELLED_CUSTOMER','CANCELLED_PROVIDER','NO_SHOW','CLOSED');
CREATE TYPE payment_mode       AS ENUM ('CASH','ONLINE');
CREATE TYPE booking_payment_status AS ENUM ('NONE','PENDING','HELD','RELEASED','PARTIALLY_REFUNDED','REFUNDED','CASH_DUE','CASH_SETTLED');
CREATE TYPE actor_role         AS ENUM ('CUSTOMER','PROVIDER','AGENT','FINANCE','ADMIN','SYSTEM');
CREATE TYPE offer_status       AS ENUM ('PENDING','ACCEPTED','DECLINED','EXPIRED','CANCELLED');
CREATE TYPE no_show_party      AS ENUM ('PROVIDER','CUSTOMER');
CREATE TYPE evidence_kind      AS ENUM ('CUSTOMER_PROBLEM','BEFORE','AFTER','CHECKLIST','COMPLAINT');
CREATE TYPE revision_status    AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');
CREATE TYPE item_kind          AS ENUM ('SERVICE','VISIT_FEE','EXTRA','PART','SURCHARGE','DISCOUNT');

CREATE TYPE verification_tier  AS ENUM ('A','B');
CREATE TYPE verification_status AS ENUM ('QUEUED','LOCKED','SUBMITTED');
CREATE TYPE verification_outcome AS ENUM ('VERIFIED_SATISFIED','VERIFIED_WITH_ISSUE','REWORK_REQUIRED','DISPUTED','LINK_CONFIRMED','AUTO_RELEASED');
CREATE TYPE work_completion    AS ENUM ('FULL','PARTIAL','NONE');
CREATE TYPE time_band          AS ENUM ('MORNING','AFTERNOON','EVENING');
CREATE TYPE attempt_result     AS ENUM ('ANSWERED','NO_ANSWER','BUSY','SWITCHED_OFF','WRONG_PERSON','CALL_DROPPED');

CREATE TYPE payment_purpose    AS ENUM ('BOOKING','TOPUP','PLAN','DEBT');
CREATE TYPE payment_status     AS ENUM ('INITIATED','CAPTURED','FAILED','EXPIRED','PARTIALLY_REFUNDED','REFUNDED');
CREATE TYPE refund_status      AS ENUM ('PENDING','SUCCEEDED','FAILED');
CREATE TYPE coupon_kind        AS ENUM ('PERCENT','FIXED');
CREATE TYPE account_type       AS ENUM ('GATEWAY_CLEARING','ESCROW','PROVIDER_WALLET','PLATFORM_COMMISSION','PENALTY_INCOME',
                                        'CUSTOMER_COMPENSATION','PROMO_EXPENSE','CUSTOMER_RECEIVABLE','PLAN_DEFERRED','PAYOUT_CLEARING');
CREATE TYPE entry_direction    AS ENUM ('DEBIT','CREDIT');
CREATE TYPE ledger_tx_type     AS ENUM ('CAPTURE','RELEASE','REFUND','COMMISSION','CASH_SETTLEMENT','CANCEL_FEE','PENALTY',
                                        'PAYOUT','PAYOUT_CONFIRM','DEBT_PAYMENT','PLAN_PURCHASE','PLAN_RELEASE','ADJUSTMENT','REVERSAL');
CREATE TYPE payout_batch_status AS ENUM ('DRAFT','EXPORTED','PAID','PARTIALLY_FAILED');
CREATE TYPE payout_status      AS ENUM ('REQUESTED','APPROVED','IN_BATCH','PAID','FAILED','CANCELLED');

CREATE TYPE complaint_category AS ENUM ('MISBEHAVIOUR','QUALITY','OVERCHARGE','NO_SHOW','SAFETY','NON_PAYMENT','UNSAFE_PREMISES','ABUSE','CASH_DISCREPANCY','OTHER');
CREATE TYPE complaint_severity AS ENUM ('SAFETY','HIGH','NORMAL');
CREATE TYPE complaint_status   AS ENUM ('OPEN','UNDER_REVIEW','AWAITING_RESPONSE','RESOLVED','REJECTED');
CREATE TYPE complaint_source   AS ENUM ('CUSTOMER','PROVIDER','VERIFICATION_AUTO','RECEIPT_LINK','POST_RELEASE');
CREATE TYPE complaint_resolution AS ENUM ('NO_ACTION','WARNING','PARTIAL_REFUND','FULL_REFUND','PROVIDER_PENALTY','TEMPORARY_SUSPENSION','PERMANENT_BLOCK');
CREATE TYPE complaint_event_type AS ENUM ('CREATED','STATUS_CHANGED','COMMENT','EVIDENCE_ADDED','PARTY_REPLY');
CREATE TYPE dispute_origin     AS ENUM ('VERIFICATION','REWORK_FAILED','REWORK_EXPIRED','WARRANTY','COMPLAINT');
CREATE TYPE dispute_status     AS ENUM ('OPEN','AWAITING_PROVIDER_REPLY','READY','RESOLVED');
CREATE TYPE dispute_resolution AS ENUM ('FULL_RELEASE','PARTIAL_RELEASE','FULL_REFUND','REFUND_WITH_PENALTY');

CREATE TYPE breach_category    AS ENUM ('RELIABILITY','QUALITY','INTEGRITY','SAFETY','CONDUCT');
CREATE TYPE penalty_status     AS ENUM ('PROPOSED','APPLIED','APPEALED','UPHELD','REVERSED','WITHDRAWN');
CREATE TYPE appeal_status      AS ENUM ('OPEN','UPHELD','REVERSED','PARTIAL');
CREATE TYPE flag_kind          AS ENUM ('VERIFIED_WITH_ISSUE','LOW_RATING','CANCELLATIONS','EVIDENCE_ANOMALY');

CREATE TYPE subscription_status AS ENUM ('ACTIVE','CANCELLED','EXPIRED');
CREATE TYPE plan_visit_status  AS ENUM ('PENDING','BOOKED','CONSUMED','FORFEITED','REFUNDED');
CREATE TYPE notification_channel AS ENUM ('SMS','EMAIL','IN_APP','WHATSAPP');
CREATE TYPE notification_status AS ENUM ('QUEUED','SENT','DELIVERED','FAILED','READ');
CREATE TYPE report_status      AS ENUM ('QUEUED','RUNNING','DONE','FAILED');

-- ---------------------------------------------------------------------
-- GENERIC TRIGGER FUNCTIONS
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION trg_insert_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'table % is insert-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001'; END $$;

CREATE FUNCTION trg_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'physical delete is not permitted on %', TG_TABLE_NAME USING ERRCODE = 'P0001'; END $$;

-- ---------------------------------------------------------------------
-- IDENTITY
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         text UNIQUE,
  email              citext UNIQUE,
  password_hash      text NOT NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL DEFAULT '',
  locale             text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ur')),
  status             user_status NOT NULL DEFAULT 'ACTIVE',
  phone_verified_at  timestamptz,
  email_verified_at  timestamptz,
  totp_secret_enc    bytea,
  totp_enabled_at    timestamptz,
  last_login_at      timestamptz,
  deactivated_at     timestamptz,
  anonymised_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER users_no_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION trg_no_delete();

CREATE TABLE roles (
  code  text PRIMARY KEY,            -- CUSTOMER, PROVIDER, AGENT, FINANCE, ADMIN
  name  text NOT NULL
);
CREATE TABLE permissions (
  code        text PRIMARY KEY,      -- e.g. verification.submit, refunds.create
  description text NOT NULL
);
CREATE TABLE role_permissions (
  role_code       text REFERENCES roles(code),
  permission_code text REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);
CREATE TABLE user_roles (
  user_id    uuid REFERENCES users(id),
  role_code  text REFERENCES roles(code),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  family_id          uuid NOT NULL,
  refresh_token_hash text NOT NULL UNIQUE,
  user_agent         text,
  ip                 inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  replaced_by        uuid REFERENCES sessions(id)
);
CREATE INDEX sessions_user_idx ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id),
  target       text NOT NULL,                 -- phone or email
  purpose      otp_purpose NOT NULL,
  code_hash    text NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_target_idx ON otp_codes(target, purpose, created_at DESC);

-- ---------------------------------------------------------------------
-- PLACE
-- ---------------------------------------------------------------------
CREATE TABLE cities (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  timezone  text NOT NULL DEFAULT 'Asia/Karachi',
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE areas (
  id        serial PRIMARY KEY,
  city_id   int NOT NULL REFERENCES cities(id),
  name      text NOT NULL,
  centroid  geography(Point,4326),
  boundary  geography(MultiPolygon,4326),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (city_id, name)
);
CREATE INDEX areas_city_idx ON areas(city_id);

-- ---------------------------------------------------------------------
-- CATALOGUE
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id                   serial PRIMARY KEY,
  slug                 text NOT NULL UNIQUE,
  name_en              text NOT NULL,
  name_ur              text NOT NULL,
  sort_order           int NOT NULL DEFAULT 0,
  default_warranty_days int NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true
);
CREATE TABLE services (
  id                    serial PRIMARY KEY,
  category_id           int NOT NULL REFERENCES categories(id),
  slug                  text NOT NULL UNIQUE,
  name_en               text NOT NULL,
  name_ur               text NOT NULL,
  description           text NOT NULL,
  pricing_model         pricing_model NOT NULL,
  time_unit             time_unit,
  base_price_paisa      bigint NOT NULL CHECK (base_price_paisa >= 0),
  min_price_paisa       bigint NOT NULL CHECK (min_price_paisa >= 0),
  max_price_paisa       bigint NOT NULL,
  visit_fee_paisa       bigint NOT NULL DEFAULT 0,
  expected_duration_min int NOT NULL CHECK (expected_duration_min > 0),
  is_emergency_eligible boolean NOT NULL DEFAULT false,
  is_plan_eligible      boolean NOT NULL DEFAULT false,
  warranty_days         int NOT NULL DEFAULT 0,
  is_high_risk          boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (min_price_paisa <= base_price_paisa AND base_price_paisa <= max_price_paisa),
  CHECK ((pricing_model = 'TIME_BASED') = (time_unit IS NOT NULL)),
  CHECK (pricing_model <> 'INSPECTION_FIRST' OR visit_fee_paisa > 0)
);
CREATE INDEX services_category_idx ON services(category_id) WHERE is_active;
CREATE TRIGGER services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE service_checklist_items (
  id             serial PRIMARY KEY,
  service_id     int NOT NULL REFERENCES services(id),
  position       int NOT NULL,
  label_en       text NOT NULL,
  label_ur       text NOT NULL,
  requires_photo boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (service_id, position)
);

-- ---------------------------------------------------------------------
-- CUSTOMERS & PROVIDERS
-- ---------------------------------------------------------------------
CREATE TABLE customers (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(user_id),
  label       text NOT NULL,
  line1       text NOT NULL,
  line2       text,
  area_id     int NOT NULL REFERENCES areas(id),
  location    geography(Point,4326) NOT NULL,
  notes       text,
  is_default  boolean NOT NULL DEFAULT false,
  archived_at timestamptz,                         -- soft delete: bookings reference it
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_customer_idx ON addresses(customer_id) WHERE archived_at IS NULL;
CREATE INDEX addresses_location_gix ON addresses USING gist(location);
CREATE UNIQUE INDEX addresses_one_default ON addresses(customer_id) WHERE is_default AND archived_at IS NULL;

CREATE TABLE providers (
  user_id                      uuid PRIMARY KEY REFERENCES users(id),
  status                       provider_status NOT NULL DEFAULT 'DRAFT',
  bio                          text,
  experience_years             smallint CHECK (experience_years BETWEEN 0 AND 60),
  qualification                text,
  photo_key                    text,
  city_id                      int REFERENCES cities(id),
  base_address_text            text,
  base_location                geography(Point,4326),
  radius_m                     int NOT NULL DEFAULT 8000 CHECK (radius_m BETWEEN 500 AND 50000),
  cnic_enc                     bytea,
  cnic_hash                    text UNIQUE,              -- HMAC blind index
  penalty_schedule_accepted_at timestamptz,
  submitted_at                 timestamptz,
  approved_at                  timestamptz,
  approved_by                  uuid REFERENCES users(id),
  rejection_reason             text,
  suspended_until              timestamptz,
  blocked_reason               text,
  offer_blocked_reason         text,                     -- 'DEBT' | 'SUSPENDED' | null
  tier_badge                   text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX providers_status_idx ON providers(status);
CREATE INDEX providers_city_idx ON providers(city_id);
CREATE INDEX providers_location_gix ON providers USING gist(base_location);
CREATE TRIGGER providers_updated BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE favourites (
  customer_id uuid REFERENCES customers(user_id),
  provider_id uuid REFERENCES providers(user_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, provider_id)
);

CREATE TABLE provider_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  doc_type    document_type NOT NULL,
  storage_key text NOT NULL,
  status      review_status NOT NULL DEFAULT 'PENDING',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_documents_provider_idx ON provider_documents(provider_id);

CREATE TABLE provider_services (
  provider_id uuid REFERENCES providers(user_id),
  service_id  int REFERENCES services(id),
  status      approval_status NOT NULL DEFAULT 'PENDING',
  price_paisa bigint NOT NULL CHECK (price_paisa >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, service_id)
);
CREATE INDEX provider_services_service_idx ON provider_services(service_id, status);

CREATE TABLE provider_service_areas (
  provider_id uuid REFERENCES providers(user_id),
  area_id     int REFERENCES areas(id),
  PRIMARY KEY (provider_id, area_id)
);
CREATE INDEX provider_service_areas_area_idx ON provider_service_areas(area_id);

CREATE TABLE provider_availability (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX provider_availability_idx ON provider_availability(provider_id, weekday);

CREATE TABLE provider_time_off (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  period      tstzrange NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (provider_id WITH =, period WITH &&)
);

CREATE TABLE provider_payout_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        uuid NOT NULL REFERENCES providers(user_id),
  kind               payout_account_kind NOT NULL,
  account_title      text NOT NULL,
  institution        text NOT NULL,                 -- bank or wallet name
  account_number_enc bytea NOT NULL,
  account_last4      text NOT NULL,
  is_default         boolean NOT NULL DEFAULT false,
  verified_at        timestamptz,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payout_accounts_one_default ON provider_payout_accounts(provider_id) WHERE is_default AND archived_at IS NULL;

-- projection maintained by the worker (read model for search & dashboards)
CREATE TABLE provider_stats (
  provider_id          uuid PRIMARY KEY REFERENCES providers(user_id),
  rating_score         numeric(3,2),
  rating_count         int NOT NULL DEFAULT 0,
  rating_distribution  int[] NOT NULL DEFAULT '{0,0,0,0,0}',
  verified_jobs        int NOT NULL DEFAULT 0,
  completed_jobs       int NOT NULL DEFAULT 0,
  completion_rate      numeric(5,4) NOT NULL DEFAULT 0,
  acceptance_rate      numeric(5,4) NOT NULL DEFAULT 0,
  cancellations_30d    int NOT NULL DEFAULT 0,
  rework_rate          numeric(5,4) NOT NULL DEFAULT 0,
  median_response_sec  int,
  active_demerits      int NOT NULL DEFAULT 0,
  last_active_at       timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_stats_rating_idx ON provider_stats(rating_score DESC NULLS LAST);

CREATE TABLE commission_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          commission_scope NOT NULL,
  category_id    int REFERENCES categories(id),
  provider_id    uuid REFERENCES providers(user_id),
  rate_bp        int NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),   -- basis points
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope='GLOBAL'   AND category_id IS NULL AND provider_id IS NULL) OR
         (scope='CATEGORY' AND category_id IS NOT NULL AND provider_id IS NULL) OR
         (scope='PROVIDER' AND provider_id IS NOT NULL AND category_id IS NULL))
);

-- ---------------------------------------------------------------------
-- PLANS (declared before bookings: bookings reference subscriptions)
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en         text NOT NULL,
  name_ur         text NOT NULL,
  description     text NOT NULL,
  price_paisa     bigint NOT NULL CHECK (price_paisa > 0),
  duration_months smallint NOT NULL CHECK (duration_months > 0),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plan_services (
  plan_id         uuid REFERENCES plans(id),
  service_id      int REFERENCES services(id),
  visits_included smallint NOT NULL CHECK (visits_included > 0),
  interval_days   smallint NOT NULL CHECK (interval_days > 0),
  PRIMARY KEY (plan_id, service_id)
);
CREATE TABLE subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid NOT NULL REFERENCES customers(user_id),
  plan_id               uuid NOT NULL REFERENCES plans(id),
  address_id            uuid NOT NULL REFERENCES addresses(id),
  preferred_provider_id uuid REFERENCES providers(user_id),
  status                subscription_status NOT NULL DEFAULT 'ACTIVE',
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  cancelled_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- COUPONS
-- ---------------------------------------------------------------------
CREATE TABLE coupons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               citext NOT NULL UNIQUE,
  kind               coupon_kind NOT NULL,
  value              int NOT NULL CHECK (value > 0),        -- bp for PERCENT, paisa for FIXED
  max_discount_paisa bigint,
  valid_from         timestamptz NOT NULL,
  valid_to           timestamptz NOT NULL,
  usage_limit        int,
  per_customer_limit int NOT NULL DEFAULT 1,
  is_referral        boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- BOOKINGS
-- ---------------------------------------------------------------------
CREATE SEQUENCE booking_code_seq;

CREATE TABLE bookings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL UNIQUE DEFAULT ('SHM-' || lpad(nextval('booking_code_seq')::text, 7, '0')),
  customer_id            uuid NOT NULL REFERENCES customers(user_id),
  provider_id            uuid REFERENCES providers(user_id),      -- null while auto-assign pending
  service_id             int NOT NULL REFERENCES services(id),
  address_id             uuid NOT NULL REFERENCES addresses(id),
  subscription_id        uuid REFERENCES subscriptions(id),
  status                 booking_status NOT NULL,
  payment_mode           payment_mode NOT NULL,
  payment_status         booking_payment_status NOT NULL DEFAULT 'NONE',
  is_emergency           boolean NOT NULL DEFAULT false,
  is_auto_assign         boolean NOT NULL DEFAULT false,
  slot                   tstzrange NOT NULL,                      -- includes travel buffer
  scheduled_start        timestamptz NOT NULL,
  scheduled_end          timestamptz NOT NULL,
  problem_text           text,
  quoted_amount_paisa    bigint NOT NULL CHECK (quoted_amount_paisa >= 0),
  approved_total_paisa   bigint NOT NULL,
  final_amount_paisa     bigint,
  discount_paisa         bigint NOT NULL DEFAULT 0,
  commission_rate_bp     int NOT NULL,                            -- snapshot at checkout
  coupon_id              uuid REFERENCES coupons(id),
  start_otp_hash         text,
  start_otp_attempts     smallint NOT NULL DEFAULT 0,
  start_otp_locked_until timestamptz,
  start_otp_verified_at  timestamptz,
  checkin_at             timestamptz,
  checkin_distance_m     int,
  checkin_accuracy_m     int,
  checkout_at            timestamptz,
  checkout_distance_m    int,
  completed_at           timestamptz,
  verification_tier      verification_tier,
  visit_no               smallint NOT NULL DEFAULT 1,             -- increments on rework
  failed_rework_count    smallint NOT NULL DEFAULT 0,
  reschedule_count       smallint NOT NULL DEFAULT 0,
  no_show_party          no_show_party,
  cancel_reason          text,
  released_at            timestamptz,
  warranty_until         timestamptz,
  closed_at              timestamptz,
  version                int NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_end > scheduled_start),
  CHECK (final_amount_paisa IS NULL OR final_amount_paisa <= approved_total_paisa),
  CHECK (approved_total_paisa >= quoted_amount_paisa),
  CHECK (status NOT IN ('WORK_COMPLETED','AWAITING_VERIFICATION','VERIFIED','AUTO_RELEASED','DISPUTED',
                        'PAYMENT_RELEASED','PARTIALLY_REFUNDED','REFUNDED','CLOSED')
         OR start_otp_verified_at IS NOT NULL),
  CHECK (status NOT IN ('ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION','WORK_COMPLETED')
         OR provider_id IS NOT NULL),
  -- no double booking of a provider (FR-BK-02)
  CONSTRAINT bookings_no_provider_overlap EXCLUDE USING gist (provider_id WITH =, slot WITH &&)
    WHERE (status IN ('PENDING_PAYMENT','REQUESTED','ACCEPTED','SCHEDULED','EN_ROUTE','IN_PROGRESS','QUOTE_REVISION'))
);
CREATE INDEX bookings_customer_idx ON bookings(customer_id, created_at DESC);
CREATE INDEX bookings_provider_idx ON bookings(provider_id, scheduled_start);
CREATE INDEX bookings_status_idx   ON bookings(status);
CREATE INDEX bookings_service_idx  ON bookings(service_id);
CREATE INDEX bookings_created_idx  ON bookings(created_at);
CREATE TRIGGER bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER bookings_no_delete BEFORE DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION trg_no_delete();

CREATE TABLE booking_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  provider_id  uuid NOT NULL REFERENCES providers(user_id),
  rank         smallint NOT NULL,
  status       offer_status NOT NULL DEFAULT 'PENDING',
  offered_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  responded_at timestamptz,
  UNIQUE (booking_id, provider_id)
);
CREATE UNIQUE INDEX booking_offers_one_pending ON booking_offers(booking_id) WHERE status = 'PENDING';
CREATE INDEX booking_offers_provider_idx ON booking_offers(provider_id, status);

CREATE TABLE booking_status_history (
  id            bigserial PRIMARY KEY,
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  from_status   booking_status,
  to_status     booking_status NOT NULL,
  event         text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  actor_role    actor_role NOT NULL,
  reason        text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_history_booking_idx ON booking_status_history(booking_id, id);
CREATE TRIGGER bsh_insert_only BEFORE UPDATE OR DELETE ON booking_status_history FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

CREATE TABLE messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES bookings(id),
  sender_user_id uuid NOT NULL REFERENCES users(id),
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  attachment_key text,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_booking_idx ON messages(booking_id, created_at);

-- ---------------------------------------------------------------------
-- EXECUTION & EVIDENCE
-- ---------------------------------------------------------------------
CREATE TABLE job_evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  kind               evidence_kind NOT NULL,
  visit_no           smallint NOT NULL DEFAULT 1,
  checklist_item_id  int REFERENCES service_checklist_items(id),
  storage_key        text NOT NULL,
  content_type       text NOT NULL,
  size_bytes         int NOT NULL,
  client_uuid        uuid NOT NULL,                 -- dedupe offline retries
  client_captured_at timestamptz,
  received_at        timestamptz NOT NULL DEFAULT now(),   -- authoritative timestamp
  location           geography(Point,4326),
  uploaded_by        uuid NOT NULL REFERENCES users(id),
  UNIQUE (booking_id, client_uuid)
);
CREATE INDEX job_evidence_booking_idx ON job_evidence(booking_id, kind);
CREATE TRIGGER job_evidence_insert_only BEFORE UPDATE OR DELETE ON job_evidence FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

CREATE TABLE job_checklist_results (
  booking_id        uuid REFERENCES bookings(id),
  checklist_item_id int REFERENCES service_checklist_items(id),
  visit_no          smallint NOT NULL DEFAULT 1,
  done              boolean NOT NULL,
  evidence_id       uuid REFERENCES job_evidence(id),
  completed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, checklist_item_id, visit_no)
);

CREATE TABLE payments (   -- declared here: quote_revisions reference top-up payments
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose          payment_purpose NOT NULL,
  booking_id       uuid REFERENCES bookings(id),
  subscription_id  uuid REFERENCES subscriptions(id),
  payer_user_id    uuid NOT NULL REFERENCES users(id),
  gateway          text NOT NULL,
  gateway_ref      text,
  amount_paisa     bigint NOT NULL CHECK (amount_paisa > 0),
  refunded_paisa   bigint NOT NULL DEFAULT 0,
  status           payment_status NOT NULL DEFAULT 'INITIATED',
  idempotency_key  text NOT NULL UNIQUE,
  expires_at       timestamptz,
  captured_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, gateway_ref),
  CHECK (refunded_paisa <= amount_paisa)
);
CREATE INDEX payments_booking_idx ON payments(booking_id);
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE quote_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id),
  status           revision_status NOT NULL DEFAULT 'PENDING',
  reason           text NOT NULL,
  delta_paisa      bigint NOT NULL CHECK (delta_paisa > 0),
  topup_payment_id uuid REFERENCES payments(id),
  raised_by        uuid NOT NULL REFERENCES users(id),
  raised_at        timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid REFERENCES users(id),
  decided_at       timestamptz
);
CREATE UNIQUE INDEX quote_revisions_one_pending ON quote_revisions(booking_id) WHERE status = 'PENDING';

CREATE TABLE booking_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id),
  revision_id      uuid REFERENCES quote_revisions(id),
  kind             item_kind NOT NULL,
  description      text NOT NULL,
  quantity         numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_paisa bigint NOT NULL,
  amount_paisa     bigint NOT NULL,                -- negative only for DISCOUNT
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'DISCOUNT') = (amount_paisa < 0) OR amount_paisa = 0)
);
CREATE INDEX booking_items_booking_idx ON booking_items(booking_id);

CREATE SEQUENCE invoice_number_seq;
CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL UNIQUE REFERENCES bookings(id),
  number          text NOT NULL UNIQUE DEFAULT ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0')),
  subtotal_paisa  bigint NOT NULL,
  surcharge_paisa bigint NOT NULL DEFAULT 0,
  discount_paisa  bigint NOT NULL DEFAULT 0,
  total_paisa     bigint NOT NULL,
  pdf_key         text,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (total_paisa = subtotal_paisa + surcharge_paisa - discount_paisa)
);

CREATE TABLE coupon_redemptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id      uuid NOT NULL REFERENCES coupons(id),
  customer_id    uuid NOT NULL REFERENCES customers(user_id),
  booking_id     uuid NOT NULL UNIQUE REFERENCES bookings(id),
  discount_paisa bigint NOT NULL CHECK (discount_paisa > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  service_id      int NOT NULL REFERENCES services(id),
  due_date        date NOT NULL,
  value_paisa     bigint NOT NULL,
  booking_id      uuid UNIQUE REFERENCES bookings(id),
  status          plan_visit_status NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX plan_visits_due_idx ON plan_visits(status, due_date);

-- ---------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------
CREATE TABLE staff_conflicts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES users(id),
  other_user_id uuid NOT NULL REFERENCES users(id),
  reason        text NOT NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_user_id, other_user_id)
);

CREATE TABLE verification_calls (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                uuid NOT NULL REFERENCES bookings(id),
  visit_no                  smallint NOT NULL DEFAULT 1,     -- one record per completed visit
  tier                      verification_tier NOT NULL,
  routing_reasons           text[] NOT NULL DEFAULT '{}',
  priority                  smallint NOT NULL DEFAULT 1,     -- 0 = cash
  status                    verification_status NOT NULL DEFAULT 'QUEUED',
  sla_due_at                timestamptz NOT NULL,
  sla_breached_at           timestamptz,
  next_attempt_at           timestamptz NOT NULL DEFAULT now(),
  locked_by                 uuid REFERENCES users(id),
  locked_at                 timestamptz,
  -- questionnaire (SRS §5.3)
  agent_id                  uuid REFERENCES users(id),
  outcome                   verification_outcome,
  work_completed            work_completion,
  quality                   smallint CHECK (quality BETWEEN 1 AND 5),
  punctuality               smallint CHECK (punctuality BETWEEN 1 AND 5),
  conduct                   smallint CHECK (conduct BETWEEN 1 AND 5),
  cleanliness               smallint CHECK (cleanliness BETWEEN 1 AND 5),
  extra_charge_demanded     boolean,
  extra_charge_amount_paisa bigint,
  uniform_worn              boolean,
  own_tools                 boolean,
  consent_line_read         boolean,
  consent_to_release        boolean,
  remark_text               text,
  recording_ref             text,
  call_duration_seconds     int,
  submitted_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, visit_no),
  CHECK ((status = 'SUBMITTED') = (outcome IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status <> 'LOCKED' OR (locked_by IS NOT NULL AND locked_at IS NOT NULL)),
  -- agent outcomes require the full questionnaire
  CHECK (outcome IS NULL OR outcome IN ('AUTO_RELEASED','LINK_CONFIRMED') OR
         (agent_id IS NOT NULL AND work_completed IS NOT NULL AND quality IS NOT NULL AND punctuality IS NOT NULL
          AND conduct IS NOT NULL AND cleanliness IS NOT NULL AND extra_charge_demanded IS NOT NULL
          AND consent_line_read IS TRUE AND consent_to_release IS NOT NULL)),
  -- integrity guard (SRS §5.4)
  CHECK (outcome IS NULL OR outcome IN ('DISPUTED','AUTO_RELEASED')
         OR (coalesce(extra_charge_demanded,false) = false AND coalesce(work_completed,'FULL') <> 'NONE')),
  CHECK (outcome IS NULL OR outcome NOT IN ('VERIFIED_SATISFIED','VERIFIED_WITH_ISSUE') OR consent_to_release IS TRUE)
);
CREATE INDEX verification_queue_idx ON verification_calls(priority, sla_due_at) WHERE status = 'QUEUED';
CREATE INDEX verification_calls_status_idx ON verification_calls(status, tier);

CREATE FUNCTION trg_verification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'verification_calls cannot be deleted'; END IF;
  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'verification record % is immutable once submitted; use verification_amendments', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_calls_immutable BEFORE UPDATE OR DELETE ON verification_calls
  FOR EACH ROW EXECUTE FUNCTION trg_verification_immutable();

CREATE TABLE verification_call_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_call_id uuid NOT NULL REFERENCES verification_calls(id),
  attempt_no           smallint NOT NULL,
  agent_id             uuid NOT NULL REFERENCES users(id),
  band                 time_band NOT NULL,
  started_at           timestamptz NOT NULL,
  ended_at             timestamptz,
  duration_seconds     int,
  result               attempt_result NOT NULL,
  call_ref             text,
  recording_ref        text,
  notes                text,
  UNIQUE (verification_call_id, attempt_no)
);
CREATE TRIGGER vca_insert_only BEFORE UPDATE OR DELETE ON verification_call_attempts FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

CREATE TABLE verification_links (   -- Tier B and unreachable fallback (SRS name: verification_responses)
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_call_id uuid NOT NULL REFERENCES verification_calls(id),
  token_hash           text NOT NULL UNIQUE,
  otp_hash             text NOT NULL,
  channels             notification_channel[] NOT NULL,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  otp_attempts         smallint NOT NULL DEFAULT 0,
  responded_at         timestamptz,
  answers              jsonb
);

CREATE TABLE verification_amendments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_call_id uuid NOT NULL REFERENCES verification_calls(id),
  field                text NOT NULL,
  old_value            jsonb,
  new_value            jsonb,
  reason               text NOT NULL,
  amended_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER va_insert_only BEFORE UPDATE OR DELETE ON verification_amendments FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

-- ---------------------------------------------------------------------
-- PAYMENTS & LEDGER
-- ---------------------------------------------------------------------
CREATE TABLE payment_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway          text NOT NULL,
  gateway_event_id text NOT NULL,
  payment_id       uuid REFERENCES payments(id),
  type             text NOT NULL,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  UNIQUE (gateway, gateway_event_id)       -- webhook idempotency (FR-PY-09)
);

CREATE TABLE ledger_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            account_type NOT NULL,
  owner_user_id   uuid REFERENCES users(id),      -- provider/customer accounts
  booking_id      uuid REFERENCES bookings(id),   -- ESCROW dimension
  subscription_id uuid REFERENCES subscriptions(id), -- PLAN_DEFERRED dimension
  currency        char(3) NOT NULL DEFAULT 'PKR',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_uniq UNIQUE NULLS NOT DISTINCT (type, owner_user_id, booking_id, subscription_id)
);

CREATE TABLE ledger_transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                    ledger_tx_type NOT NULL,
  booking_id              uuid REFERENCES bookings(id),
  idempotency_key         text NOT NULL UNIQUE,
  reverses_transaction_id uuid REFERENCES ledger_transactions(id),
  memo                    text,
  created_by              uuid REFERENCES users(id),     -- null = system
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_tx_booking_idx ON ledger_transactions(booking_id);
CREATE TRIGGER ltx_insert_only BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

CREATE TABLE ledger_entries (
  id             bigserial PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id     uuid NOT NULL REFERENCES ledger_accounts(id),
  direction      entry_direction NOT NULL,
  amount_paisa   bigint NOT NULL CHECK (amount_paisa > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries(account_id, id);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries(transaction_id);
CREATE TRIGGER le_insert_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

-- every transaction must balance at commit
CREATE FUNCTION trg_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n int;
BEGIN
  SELECT coalesce(sum(amount_paisa) FILTER (WHERE direction='DEBIT'),0),
         coalesce(sum(amount_paisa) FILTER (WHERE direction='CREDIT'),0), count(*)
    INTO d, c, n FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'ledger transaction % unbalanced: debit % credit % lines %', NEW.transaction_id, d, c, n;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_ledger_balanced();

-- derived balances, maintained only by trigger
CREATE TABLE account_balances (
  account_id   uuid PRIMARY KEY REFERENCES ledger_accounts(id),
  debit_total  bigint NOT NULL DEFAULT 0,
  credit_total bigint NOT NULL DEFAULT 0,
  balance      bigint GENERATED ALWAYS AS (credit_total - debit_total) STORED,   -- liability view
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION trg_apply_balance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO account_balances(account_id, debit_total, credit_total)
  VALUES (NEW.account_id,
          CASE WHEN NEW.direction='DEBIT'  THEN NEW.amount_paisa ELSE 0 END,
          CASE WHEN NEW.direction='CREDIT' THEN NEW.amount_paisa ELSE 0 END)
  ON CONFLICT (account_id) DO UPDATE SET
    debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
    credit_total = account_balances.credit_total + EXCLUDED.credit_total,
    updated_at   = now();
  RETURN NULL;
END $$;
CREATE TRIGGER ledger_entries_apply_balance AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION trg_apply_balance();

CREATE TABLE refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            uuid NOT NULL REFERENCES payments(id),
  booking_id            uuid REFERENCES bookings(id),
  amount_paisa          bigint NOT NULL CHECK (amount_paisa > 0),
  reason_code           text NOT NULL,
  reason_text           text,
  status                refund_status NOT NULL DEFAULT 'PENDING',
  gateway_refund_ref    text,
  idempotency_key       text NOT NULL UNIQUE,
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  requested_by          uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE TABLE payout_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  status       payout_batch_status NOT NULL DEFAULT 'DRAFT',
  file_key     text,
  total_paisa  bigint NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  exported_at  timestamptz,
  paid_at      timestamptz
);
CREATE TABLE payouts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           uuid NOT NULL REFERENCES providers(user_id),
  payout_account_id     uuid NOT NULL REFERENCES provider_payout_accounts(id),
  batch_id              uuid REFERENCES payout_batches(id),
  amount_paisa          bigint NOT NULL CHECK (amount_paisa > 0),
  status                payout_status NOT NULL DEFAULT 'REQUESTED',
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  failure_reason        text,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  paid_at               timestamptz
);
CREATE INDEX payouts_provider_idx ON payouts(provider_id, requested_at DESC);

-- ---------------------------------------------------------------------
-- RATINGS & REPUTATION
-- ---------------------------------------------------------------------
CREATE TABLE ratings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_call_id uuid NOT NULL UNIQUE REFERENCES verification_calls(id),   -- FR-RT-03
  booking_id           uuid NOT NULL REFERENCES bookings(id),
  provider_id          uuid NOT NULL REFERENCES providers(user_id),
  customer_id          uuid NOT NULL REFERENCES customers(user_id),
  quality              smallint NOT NULL CHECK (quality BETWEEN 1 AND 5),
  punctuality          smallint NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
  conduct              smallint NOT NULL CHECK (conduct BETWEEN 1 AND 5),
  cleanliness          smallint NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  score                numeric(3,2) GENERATED ALWAYS AS ((quality + punctuality + conduct + cleanliness) / 4.0) STORED,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ratings_provider_idx ON ratings(provider_id, created_at DESC);

CREATE FUNCTION trg_rating_requires_verification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o verification_outcome; b uuid;
BEGIN
  SELECT outcome, booking_id INTO o, b FROM verification_calls WHERE id = NEW.verification_call_id;
  IF o IS NULL OR o NOT IN ('VERIFIED_SATISFIED','VERIFIED_WITH_ISSUE','LINK_CONFIRMED') THEN
    RAISE EXCEPTION 'rating requires a submitted verification with a rating-producing outcome (got %)', o;
  END IF;
  IF b <> NEW.booking_id THEN RAISE EXCEPTION 'rating booking mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ratings_require_verification BEFORE INSERT ON ratings
  FOR EACH ROW EXECUTE FUNCTION trg_rating_requires_verification();
CREATE TRIGGER ratings_insert_only BEFORE UPDATE OR DELETE ON ratings FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

CREATE TABLE remarks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id          uuid NOT NULL UNIQUE REFERENCES ratings(id),
  provider_id        uuid NOT NULL REFERENCES providers(user_id),
  body               text NOT NULL,
  display_name       text NOT NULL,         -- "Ayesha K."
  is_published       boolean NOT NULL DEFAULT true,
  unpublished_by     uuid REFERENCES users(id),
  unpublished_reason text,
  unpublished_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX remarks_provider_idx ON remarks(provider_id, created_at DESC) WHERE is_published;

CREATE TABLE remark_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remark_id   uuid NOT NULL UNIQUE REFERENCES remarks(id),     -- one reply per remark
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  body        text NOT NULL CHECK (length(body) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER remark_replies_insert_only BEFORE UPDATE OR DELETE ON remark_replies FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

-- ---------------------------------------------------------------------
-- COMPLAINTS & DISPUTES
-- ---------------------------------------------------------------------
CREATE TABLE complaints (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid REFERENCES bookings(id),
  raised_by_user_id uuid REFERENCES users(id),           -- null when system-generated
  against_user_id   uuid NOT NULL REFERENCES users(id),
  source            complaint_source NOT NULL,
  category          complaint_category NOT NULL,
  severity          complaint_severity NOT NULL,
  status            complaint_status NOT NULL DEFAULT 'OPEN',
  description       text NOT NULL,
  sla_due_at        timestamptz NOT NULL,
  assigned_to       uuid REFERENCES users(id),
  resolution        complaint_resolution,
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  CHECK ((status IN ('RESOLVED','REJECTED')) = (resolved_at IS NOT NULL))
);
CREATE INDEX complaints_queue_idx ON complaints(status, severity, sla_due_at);
CREATE INDEX complaints_against_idx ON complaints(against_user_id);

CREATE TABLE complaint_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  uuid NOT NULL REFERENCES complaints(id),
  actor_user_id uuid REFERENCES users(id),
  type          complaint_event_type NOT NULL,
  from_status   complaint_status,
  to_status     complaint_status,
  body          text,
  evidence_key  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER complaint_events_insert_only BEFORE UPDATE OR DELETE ON complaint_events FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

CREATE TABLE disputes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid NOT NULL REFERENCES bookings(id),
  complaint_id        uuid REFERENCES complaints(id),
  origin              dispute_origin NOT NULL,
  status              dispute_status NOT NULL DEFAULT 'OPEN',
  reply_due_at        timestamptz,
  provider_reply      text,
  provider_replied_at timestamptz,
  resolution          dispute_resolution,
  release_paisa       bigint,
  refund_paisa        bigint,
  resolved_by         uuid REFERENCES users(id),
  resolved_at         timestamptz,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'RESOLVED') = (resolution IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX disputes_one_open ON disputes(booking_id) WHERE status <> 'RESOLVED';

-- ---------------------------------------------------------------------
-- CONDUCT & PENALTIES
-- ---------------------------------------------------------------------
CREATE TABLE breach_types (
  code                text PRIMARY KEY,
  name_en             text NOT NULL,
  name_ur             text NOT NULL,
  category            breach_category NOT NULL,
  points              smallint NOT NULL CHECK (points > 0),
  fine_rule           jsonb NOT NULL DEFAULT '{}',   -- e.g. {"type":"multiple_of_excess","factor":2}
  schedule_consequence text,                          -- e.g. 'SUSPENSION_7D', 'PERMANENT_BLOCK'
  is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE penalties (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           uuid NOT NULL REFERENCES providers(user_id),
  breach_code           text NOT NULL REFERENCES breach_types(code),
  booking_id            uuid REFERENCES bookings(id),
  complaint_id          uuid REFERENCES complaints(id),
  dispute_id            uuid REFERENCES disputes(id),
  status                penalty_status NOT NULL DEFAULT 'PROPOSED',
  evidence              jsonb NOT NULL DEFAULT '{}',
  fine_paisa            bigint NOT NULL DEFAULT 0 CHECK (fine_paisa >= 0),
  reply_due_at          timestamptz NOT NULL,
  provider_reply        text,
  replied_at            timestamptz,
  proposed_by           uuid NOT NULL REFERENCES users(id),
  applied_by            uuid REFERENCES users(id),
  applied_at            timestamptz,
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- FR-PN-06: no application before reply or deadline
  CHECK (applied_at IS NULL OR replied_at IS NOT NULL OR applied_at >= reply_due_at)
);
CREATE INDEX penalties_provider_idx ON penalties(provider_id, status);

CREATE TABLE demerit_awards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id      uuid NOT NULL REFERENCES providers(user_id),
  penalty_id       uuid NOT NULL UNIQUE REFERENCES penalties(id),
  points_awarded   smallint NOT NULL CHECK (points_awarded > 0),
  points_remaining smallint NOT NULL CHECK (points_remaining >= 0),
  awarded_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  last_decay_at    timestamptz,
  voided_at        timestamptz,               -- set when appeal reverses
  CHECK (points_remaining <= points_awarded)
);
CREATE INDEX demerit_awards_active_idx ON demerit_awards(provider_id) WHERE voided_at IS NULL AND points_remaining > 0;

CREATE TABLE threshold_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id             uuid NOT NULL REFERENCES providers(user_id),
  threshold               smallint NOT NULL,
  consequence             text NOT NULL,     -- WARNING | DEMOTION_30D | SUSPENSION_7D | SUSPENSION_30D_REVERIFY | PERMANENT_BLOCK
  active_points           smallint NOT NULL,
  triggered_by_penalty_id uuid REFERENCES penalties(id),
  effective_until         timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appeals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  penalty_id    uuid NOT NULL UNIQUE REFERENCES penalties(id),
  provider_id   uuid NOT NULL REFERENCES providers(user_id),
  grounds       text NOT NULL,
  status        appeal_status NOT NULL DEFAULT 'OPEN',
  decided_by    uuid REFERENCES users(id),
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);

CREATE TABLE provider_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  kind        flag_kind NOT NULL,
  booking_id  uuid REFERENCES bookings(id),
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz,
  cleared_by  uuid REFERENCES users(id)
);
CREATE INDEX provider_flags_idx ON provider_flags(provider_id, kind, created_at);

-- ---------------------------------------------------------------------
-- PLATFORM: notifications, outbox, idempotency, settings, audit, reports
-- ---------------------------------------------------------------------
CREATE TABLE notification_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key  text NOT NULL,                  -- e.g. booking.scheduled.customer
  channel    notification_channel NOT NULL,
  locale     text NOT NULL CHECK (locale IN ('en','ur')),
  subject    text,
  body       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key, channel, locale)
);

CREATE TABLE outbox_events (
  id           bigserial PRIMARY KEY,
  aggregate    text NOT NULL,
  aggregate_id text NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX outbox_unprocessed_idx ON outbox_events(id) WHERE processed_at IS NULL;

CREATE TABLE notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  event_key           text NOT NULL,
  channel             notification_channel NOT NULL,
  template_id         uuid REFERENCES notification_templates(id),
  payload             jsonb NOT NULL DEFAULT '{}',
  rendered_body       text,
  status              notification_status NOT NULL DEFAULT 'QUEUED',
  provider_message_id text,
  error               text,
  outbox_event_id     bigint REFERENCES outbox_events(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  UNIQUE (outbox_event_id, user_id, channel)          -- handler idempotency
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE idempotency_keys (
  key          text NOT NULL,
  user_id      uuid NOT NULL REFERENCES users(id),
  route        text NOT NULL,
  request_hash text NOT NULL,
  status_code  int,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id)
);

CREATE TABLE settings (
  key         text PRIMARY KEY,           -- e.g. verification.sla_min
  value       jsonb NOT NULL,
  description text NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  actor_role    actor_role NOT NULL,
  action        text NOT NULL,             -- e.g. provider.approve, settings.update
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  before        jsonb,
  after         jsonb,
  ip            inet,
  user_agent    text,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id, created_at);
CREATE INDEX audit_log_actor_idx  ON audit_log(actor_user_id, created_at);
CREATE TRIGGER audit_log_insert_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION trg_insert_only();

CREATE TABLE report_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL,              -- MONTHLY | REVENUE | PROVIDER_PERFORMANCE | VERIFICATION
  period_start date NOT NULL,
  period_end   date NOT NULL,
  format       text NOT NULL CHECK (format IN ('PDF','XLSX')),
  status       report_status NOT NULL DEFAULT 'QUEUED',
  file_key     text,
  error        text,
  requested_by uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------
-- BOOKING STATUS GUARD (only BookingStateService may change status)
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_booking_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF coalesce(current_setting('app.transition_ctx', true), '') <> 'on' THEN
      RAISE EXCEPTION 'bookings.status may only change through BookingStateService (set app.transition_ctx)';
    END IF;
    IF NEW.status = 'PAYMENT_RELEASED' AND NOT (
         EXISTS (SELECT 1 FROM verification_calls v WHERE v.booking_id = NEW.id
                  AND v.outcome IN ('VERIFIED_SATISFIED','VERIFIED_WITH_ISSUE','LINK_CONFIRMED','AUTO_RELEASED'))
      OR EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = NEW.id AND d.resolution = 'FULL_RELEASE')) THEN
      RAISE EXCEPTION 'booking % cannot be released without a release-permitting verification or dispute resolution', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_status_guard BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION trg_booking_status_guard();

-- ---------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------
CREATE VIEW v_provider_wallet AS
SELECT a.owner_user_id AS provider_id, coalesce(b.balance,0) AS balance_paisa
FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id
WHERE a.type = 'PROVIDER_WALLET';

CREATE VIEW v_escrow_by_booking AS
SELECT a.booking_id, coalesce(b.balance,0) AS held_paisa
FROM ledger_accounts a LEFT JOIN account_balances b ON b.account_id = a.id
WHERE a.type = 'ESCROW';

CREATE VIEW v_active_demerits AS
SELECT provider_id, sum(points_remaining)::int AS active_points
FROM demerit_awards
WHERE voided_at IS NULL AND points_remaining > 0 AND expires_at > now()
GROUP BY provider_id;

-- migrate:down
-- Intentionally not provided: forward-fix only for the baseline.
