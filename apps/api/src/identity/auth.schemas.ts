import { z } from 'zod';
import { OtpPurpose } from '@smart-home/contracts';
import { assertPasswordPolicy, MIN_PASSWORD_LENGTH } from './password.js';

export const SELF_REGISTER_ROLES = ['CUSTOMER', 'PROVIDER'] as const;
export type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

export const LOGIN_ROLES = ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

/**
 * The same policy the hasher enforces, applied at the edge so a weak password
 * is a 422 naming the field rather than a 500 from deep in the service.
 */
export const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200, 'Password must be at most 200 characters')
  .superRefine((value, context) => {
    try {
      assertPasswordPolicy(value);
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Password does not meet the policy' });
    }
  });

export const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Must be an E.164 number such as +923001234567');

export const identifier = z.string().trim().min(3).max(320);

export const registerSchema = z
  .object({
    role: z.enum(SELF_REGISTER_ROLES),
    phoneE164: e164,
    email: z.string().trim().email().max(320).optional(),
    password,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).default(''),
    locale: z.enum(['en', 'ur']).default('en')
  })
  .strict();

export const otpRequestSchema = z
  .object({
    target: z.string().trim().min(3).max(320),
    purpose: OtpPurpose.schema
  })
  .strict();

export const otpVerifySchema = z
  .object({
    target: z.string().trim().min(3).max(320),
    purpose: OtpPurpose.schema,
    code: z.string().trim().regex(/^\d{4,8}$/, 'The code must be numeric')
  })
  .strict();

export const loginSchema = z
  .object({
    identifier,
    password: z.string().min(1).max(200),
    totpCode: z.string().trim().regex(/^\d{6}$/).optional()
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200).optional() }).strict();

export const logoutSchema = refreshSchema;

export const passwordForgotSchema = z.object({ identifier }).strict();

export const passwordResetSchema = z
  .object({
    identifier,
    code: z.string().trim().regex(/^\d{4,8}$/),
    newPassword: password
  })
  .strict();

export const totpVerifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type PasswordForgotInput = z.infer<typeof passwordForgotSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
export type TotpVerifyInput = z.infer<typeof totpVerifySchema>;
