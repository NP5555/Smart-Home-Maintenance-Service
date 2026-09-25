import { z } from 'zod';
import { localeSchema } from './enums.js';
import { moneySchema } from './common.js';

export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
export const passwordSchema = z.string().min(12).max(128);
export const otpSchema = z.string().regex(/^\d{6}$/);
export const registrationTypeSchema = z.enum(['CUSTOMER', 'PROVIDER']);
export const registerInputSchema = z.object({ accountType: registrationTypeSchema, phone: phoneSchema, email: z.string().email().optional(), password: passwordSchema, firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().max(100).default(''), locale: z.enum(['en', 'ur']).default('en') }).strict();
export const loginInputSchema = z.object({ identifier: z.string().min(3), password: z.string().min(1).max(128), totp: z.string().regex(/^\d{6}$/).optional() }).strict();
export const otpRequestInputSchema = z.object({ userId: z.string().uuid(), purpose: z.enum(['REGISTER', 'LOGIN', 'PASSWORD_RESET']) }).strict();
export const otpVerifyInputSchema = z.object({ userId: z.string().uuid(), purpose: z.enum(['REGISTER', 'LOGIN', 'PASSWORD_RESET']), code: otpSchema }).strict();
export const forgotPasswordInputSchema = z.object({ identifier: z.string().min(3) }).strict();
export const resetPasswordInputSchema = z.object({ userId: z.string().uuid(), code: otpSchema, password: passwordSchema }).strict();
export const userOutputSchema = z.object({ id: z.string().uuid(), firstName: z.string(), lastName: z.string(), locale: localeSchema, phoneVerified: z.boolean(), roles: z.array(z.string()) }).strict();
export const authOutputSchema = z.object({ user: userOutputSchema, accessToken: z.string(), expiresInSeconds: z.number().int().positive() }).strict();
export const settingsOutputSchema = z.object({ key: z.string(), value: z.unknown() }).strict();
export const moneyOutputSchema = moneySchema;
