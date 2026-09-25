import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'BAD_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS', 'VALIDATION_FAILED', 'RATE_LIMITED', 'OTP_INVALID', 'OTP_LOCKED', 'INVALID_CREDENTIALS', 'REFRESH_REUSE_DETECTED', 'TOTP_REQUIRED', 'TOTP_INVALID', 'OUTSIDE_CALLING_HOURS', 'ILLEGAL_TRANSITION', 'SLOT_TAKEN', 'CONFLICT_OF_INTEREST', 'DEBT_BLOCKED', 'EXTERNAL_ADAPTER_FAILED', 'INTERNAL_ERROR'
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorCatalog: Record<ErrorCode, { title: string; status: number }> = {
  BAD_REQUEST: { title: 'Bad Request', status: 400 },
  UNAUTHENTICATED: { title: 'Unauthenticated', status: 401 },
  FORBIDDEN: { title: 'Forbidden', status: 403 },
  NOT_FOUND: { title: 'Not Found', status: 404 },
  CONFLICT: { title: 'Conflict', status: 409 },
  IDEMPOTENCY_REQUIRED: { title: 'Idempotency Key Required', status: 400 },
  IDEMPOTENCY_KEY_REUSED: { title: 'Idempotency Key Reused', status: 422 },
  IDEMPOTENCY_IN_PROGRESS: { title: 'Idempotency Request In Progress', status: 409 },
  VALIDATION_FAILED: { title: 'Validation Failed', status: 422 },
  RATE_LIMITED: { title: 'Too Many Requests', status: 429 },
  OTP_INVALID: { title: 'Invalid OTP', status: 422 },
  OTP_LOCKED: { title: 'OTP Locked', status: 423 },
  INVALID_CREDENTIALS: { title: 'Invalid Credentials', status: 401 },
  REFRESH_REUSE_DETECTED: { title: 'Refresh Token Reuse Detected', status: 401 },
  TOTP_REQUIRED: { title: 'TOTP Required', status: 401 },
  TOTP_INVALID: { title: 'Invalid TOTP', status: 422 },
  OUTSIDE_CALLING_HOURS: { title: 'Outside Calling Hours', status: 423 },
  ILLEGAL_TRANSITION: { title: 'Illegal Transition', status: 409 },
  SLOT_TAKEN: { title: 'Slot Taken', status: 409 },
  CONFLICT_OF_INTEREST: { title: 'Conflict of Interest', status: 403 },
  DEBT_BLOCKED: { title: 'Debt Blocked', status: 409 },
  EXTERNAL_ADAPTER_FAILED: { title: 'External Adapter Failed', status: 502 },
  INTERNAL_ERROR: { title: 'Internal Server Error', status: 500 }
};
