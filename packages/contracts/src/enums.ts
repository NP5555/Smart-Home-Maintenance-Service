import { z } from 'zod';

const enumFrom = <T extends string>(sqlType: string, values: readonly T[]) => ({
  sqlType,
  values,
  schema: z.enum(values as [T, ...T[]]),
  options: values
});

export const UserStatus = enumFrom('user_status', ['ACTIVE', 'LOCKED', 'DEACTIVATED'] as const);
export const OtpPurpose = enumFrom('otp_purpose', ['REGISTER', 'LOGIN', 'PASSWORD_RESET', 'PHONE_CHANGE'] as const);
export const ProviderStatus = enumFrom('provider_status', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED', 'DEACTIVATED'] as const);
export const DocumentType = enumFrom('document_type', ['CNIC_FRONT', 'CNIC_BACK', 'TRADE_CERT', 'CHARACTER_CERT'] as const);
export const ReviewStatus = enumFrom('review_status', ['PENDING', 'VERIFIED', 'REJECTED'] as const);
export const ApprovalStatus = enumFrom('approval_status', ['PENDING', 'APPROVED', 'REJECTED'] as const);
export const PricingModel = enumFrom('pricing_model', ['FLAT', 'TIME_BASED', 'INSPECTION_FIRST'] as const);
export const TimeUnit = enumFrom('time_unit', ['HOUR', 'DAY'] as const);
export const CommissionScope = enumFrom('commission_scope', ['GLOBAL', 'CATEGORY', 'PROVIDER'] as const);
export const PayoutAccountKind = enumFrom('payout_account_kind', ['BANK', 'WALLET'] as const);

export const BookingStatus = enumFrom('booking_status', [
  'PENDING_PAYMENT',
  'ABANDONED',
  'REQUESTED',
  'UNFULFILLED',
  'ACCEPTED',
  'SCHEDULED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'QUOTE_REVISION',
  'WORK_COMPLETED',
  'AWAITING_VERIFICATION',
  'REWORK_REQUIRED',
  'VERIFIED',
  'AUTO_RELEASED',
  'DISPUTED',
  'PAYMENT_RELEASED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CANCELLED_CUSTOMER',
  'CANCELLED_PROVIDER',
  'NO_SHOW',
  'CLOSED'
] as const);

export const PaymentMode = enumFrom('payment_mode', ['CASH', 'ONLINE'] as const);
export const BookingPaymentStatus = enumFrom('booking_payment_status', ['NONE', 'PENDING', 'HELD', 'RELEASED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CASH_DUE', 'CASH_SETTLED'] as const);
export const ActorRole = enumFrom('actor_role', ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN', 'SYSTEM'] as const);
export const OfferStatus = enumFrom('offer_status', ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const);
export const NoShowParty = enumFrom('no_show_party', ['PROVIDER', 'CUSTOMER'] as const);
export const EvidenceKind = enumFrom('evidence_kind', ['CUSTOMER_PROBLEM', 'BEFORE', 'AFTER', 'CHECKLIST', 'COMPLAINT'] as const);
export const RevisionStatus = enumFrom('revision_status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const);
export const ItemKind = enumFrom('item_kind', ['SERVICE', 'VISIT_FEE', 'EXTRA', 'PART', 'SURCHARGE', 'DISCOUNT'] as const);

export const VerificationTier = enumFrom('verification_tier', ['A', 'B'] as const);
export const VerificationStatus = enumFrom('verification_status', ['QUEUED', 'LOCKED', 'SUBMITTED'] as const);
export const VerificationOutcome = enumFrom('verification_outcome', ['VERIFIED_SATISFIED', 'VERIFIED_WITH_ISSUE', 'REWORK_REQUIRED', 'DISPUTED', 'LINK_CONFIRMED', 'AUTO_RELEASED'] as const);
export const WorkCompletion = enumFrom('work_completion', ['FULL', 'PARTIAL', 'NONE'] as const);
export const TimeBand = enumFrom('time_band', ['MORNING', 'AFTERNOON', 'EVENING'] as const);
export const AttemptResult = enumFrom('attempt_result', ['ANSWERED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'WRONG_PERSON', 'CALL_DROPPED'] as const);

export const PaymentPurpose = enumFrom('payment_purpose', ['BOOKING', 'TOPUP', 'PLAN', 'DEBT'] as const);
export const PaymentStatus = enumFrom('payment_status', ['INITIATED', 'CAPTURED', 'FAILED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const);
export const RefundStatus = enumFrom('refund_status', ['PENDING', 'SUCCEEDED', 'FAILED'] as const);
export const CouponKind = enumFrom('coupon_kind', ['PERCENT', 'FIXED'] as const);

export const AccountType = enumFrom('account_type', [
  'GATEWAY_CLEARING',
  'ESCROW',
  'PROVIDER_WALLET',
  'PLATFORM_COMMISSION',
  'PENALTY_INCOME',
  'CUSTOMER_COMPENSATION',
  'PROMO_EXPENSE',
  'CUSTOMER_RECEIVABLE',
  'PLAN_DEFERRED',
  'PAYOUT_CLEARING'
] as const);

export const EntryDirection = enumFrom('entry_direction', ['DEBIT', 'CREDIT'] as const);
export const LedgerTxType = enumFrom('ledger_tx_type', [
  'CAPTURE',
  'RELEASE',
  'REFUND',
  'COMMISSION',
  'CASH_SETTLEMENT',
  'CANCEL_FEE',
  'PENALTY',
  'PAYOUT',
  'PAYOUT_CONFIRM',
  'DEBT_PAYMENT',
  'PLAN_PURCHASE',
  'PLAN_RELEASE',
  'ADJUSTMENT',
  'REVERSAL'
] as const);

export const PayoutBatchStatus = enumFrom('payout_batch_status', ['DRAFT', 'EXPORTED', 'PAID', 'PARTIALLY_FAILED'] as const);
export const PayoutStatus = enumFrom('payout_status', ['REQUESTED', 'APPROVED', 'IN_BATCH', 'PAID', 'FAILED', 'CANCELLED'] as const);

export const ComplaintCategory = enumFrom('complaint_category', [
  'MISBEHAVIOUR',
  'QUALITY',
  'OVERCHARGE',
  'NO_SHOW',
  'SAFETY',
  'NON_PAYMENT',
  'UNSAFE_PREMISES',
  'ABUSE',
  'CASH_DISCREPANCY',
  'OTHER'
] as const);
export const ComplaintSeverity = enumFrom('complaint_severity', ['SAFETY', 'HIGH', 'NORMAL'] as const);
export const ComplaintStatus = enumFrom('complaint_status', ['OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'] as const);
export const ComplaintSource = enumFrom('complaint_source', ['CUSTOMER', 'PROVIDER', 'VERIFICATION_AUTO', 'RECEIPT_LINK', 'POST_RELEASE'] as const);
export const ComplaintResolution = enumFrom('complaint_resolution', ['NO_ACTION', 'WARNING', 'PARTIAL_REFUND', 'FULL_REFUND', 'PROVIDER_PENALTY', 'TEMPORARY_SUSPENSION', 'PERMANENT_BLOCK'] as const);
export const ComplaintEventType = enumFrom('complaint_event_type', ['CREATED', 'STATUS_CHANGED', 'COMMENT', 'EVIDENCE_ADDED', 'PARTY_REPLY'] as const);

export const DisputeOrigin = enumFrom('dispute_origin', ['VERIFICATION', 'REWORK_FAILED', 'REWORK_EXPIRED', 'WARRANTY', 'COMPLAINT'] as const);
export const DisputeStatus = enumFrom('dispute_status', ['OPEN', 'AWAITING_PROVIDER_REPLY', 'READY', 'RESOLVED'] as const);
export const DisputeResolution = enumFrom('dispute_resolution', ['FULL_RELEASE', 'PARTIAL_RELEASE', 'FULL_REFUND', 'REFUND_WITH_PENALTY'] as const);

export const BreachCategory = enumFrom('breach_category', ['RELIABILITY', 'QUALITY', 'INTEGRITY', 'SAFETY', 'CONDUCT'] as const);
export const PenaltyStatus = enumFrom('penalty_status', ['PROPOSED', 'APPLIED', 'APPEALED', 'UPHELD', 'REVERSED', 'WITHDRAWN'] as const);
export const AppealStatus = enumFrom('appeal_status', ['OPEN', 'UPHELD', 'REVERSED', 'PARTIAL'] as const);
export const FlagKind = enumFrom('flag_kind', ['VERIFIED_WITH_ISSUE', 'LOW_RATING', 'CANCELLATIONS', 'EVIDENCE_ANOMALY'] as const);

export const SubscriptionStatus = enumFrom('subscription_status', ['ACTIVE', 'CANCELLED', 'EXPIRED'] as const);
export const PlanVisitStatus = enumFrom('plan_visit_status', ['PENDING', 'BOOKED', 'CONSUMED', 'FORFEITED', 'REFUNDED'] as const);

export const NotificationChannel = enumFrom('notification_channel', ['SMS', 'EMAIL', 'IN_APP', 'WHATSAPP'] as const);
export const NotificationStatus = enumFrom('notification_status', ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ'] as const);
export const ReportStatus = enumFrom('report_status', ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const);

export const Locale = enumFrom('locale', ['en', 'ur'] as const);

export type UserStatusValue = (typeof UserStatus.values)[number];
export type ProviderStatusValue = (typeof ProviderStatus.values)[number];
export type BookingStatusValue = (typeof BookingStatus.values)[number];
export type PaymentModeValue = (typeof PaymentMode.values)[number];
export type ActorRoleValue = (typeof ActorRole.values)[number];
export type AccountTypeValue = (typeof AccountType.values)[number];
export type VerificationTierValue = (typeof VerificationTier.values)[number];
export type VerificationOutcomeValue = (typeof VerificationOutcome.values)[number];
export type LocaleValue = (typeof Locale.values)[number];
