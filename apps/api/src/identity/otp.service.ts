import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { EMAIL_SENDER, SMS_SENDER } from '../integrations/integrations.module.js';
import type { EmailSenderPort, SmsSenderPort } from '../integrations/ports.js';
import { SettingsService } from '../platform/settings.service.js';
import { TOKENS, type AuthSecrets } from './auth-secrets.js';
import { generateOtpCode, hashOtpCode, type OtpPurpose } from './otp.js';

export const OTP_COOLDOWN_MESSAGE = 'Another code was requested moments ago. Please wait before requesting another.';

/** An identifier is an email when it contains `@`; phone numbers never do. */
export const isEmailTarget = (target: string): boolean => target.includes('@');

export const normaliseTarget = (target: string): string => (isEmailTarget(target) ? target.trim().toLowerCase() : target.replace(/[\s()-]/g, ''));

export type AuthSettingsSnapshot = {
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  loginMaxAttempts: number;
  loginWindowMinutes: number;
  staffTotpRequired: boolean;
};

export const DEFAULT_AUTH_SETTINGS: AuthSettingsSnapshot = {
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendCooldownSeconds: 60,
  loginMaxAttempts: 5,
  loginWindowMinutes: 15,
  staffTotpRequired: true
};

export const readAuthSettings = async (settings: SettingsService): Promise<AuthSettingsSnapshot> => {
  const read = async <T>(key: string, fallback: T): Promise<T> => {
    const value = await settings.get<T>(key);
    return value === null || value === undefined ? fallback : value;
  };
  return {
    otpTtlMinutes: await read('auth.otp_ttl_min', DEFAULT_AUTH_SETTINGS.otpTtlMinutes),
    otpMaxAttempts: await read('auth.otp_max_attempts', DEFAULT_AUTH_SETTINGS.otpMaxAttempts),
    otpResendCooldownSeconds: await read('auth.otp_resend_cooldown_sec', DEFAULT_AUTH_SETTINGS.otpResendCooldownSeconds),
    loginMaxAttempts: await read('auth.login_max_attempts', DEFAULT_AUTH_SETTINGS.loginMaxAttempts),
    loginWindowMinutes: await read('auth.login_window_min', DEFAULT_AUTH_SETTINGS.loginWindowMinutes),
    staffTotpRequired: await read('auth.staff_totp_required', DEFAULT_AUTH_SETTINGS.staffTotpRequired)
  };
};

type OtpRow = { id: string; user_id: string | null; code_hash: string; attempts: number; expires_at: Date };

export type OtpIssued = { expiresAt: string; resendAfterSeconds: number };

@Injectable()
export class OtpService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(TOKENS) private readonly secrets: AuthSecrets,
    @Inject(SMS_SENDER) private readonly sms: SmsSenderPort,
    @Inject(EMAIL_SENDER) private readonly email: EmailSenderPort
  ) {}

  async issue(target: string, purpose: OtpPurpose, userId: string | null, locale = 'en'): Promise<OtpIssued> {
    const config = await readAuthSettings(this.settings);
    const normalised = normaliseTarget(target);
    const [recent] = await this.prisma.$queryRaw<{ created_at: Date }[]>(
      Prisma.sql`SELECT created_at FROM otp_codes WHERE target = ${normalised} AND purpose = ${purpose}::otp_purpose ORDER BY created_at DESC LIMIT 1`
    );
    if (recent !== undefined && Date.now() - new Date(recent.created_at).getTime() < config.otpResendCooldownSeconds * 1000) {
      throw new DomainError('RATE_LIMITED', OTP_COOLDOWN_MESSAGE);
    }
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60_000);
    await this.prisma.$queryRaw(
      Prisma.sql`INSERT INTO otp_codes(user_id, target, purpose, code_hash, expires_at)
                 VALUES (${userId}::uuid, ${normalised}, ${purpose}::otp_purpose, ${hashOtpCode(this.secrets.otpPepper, normalised, purpose, code)}, ${expiresAt})`
    );
    const body =
      locale === 'ur'
        ? `آپ کا تصدیقی کوڈ ${code} ہے۔ یہ ${config.otpTtlMinutes} منٹ میں میعاد ختم ہو جائے گا۔`
        : `Your Smart Home verification code is ${code}. It expires in ${config.otpTtlMinutes} minutes.`;
    if (normalised.startsWith('@')) await this.email.send(normalised, 'Your Smart Home verification code', body, { purpose });
    else await this.sms.send(normalised, body, { purpose });
    return { expiresAt: expiresAt.toISOString(), resendAfterSeconds: config.otpResendCooldownSeconds };
  }

  /**
   * FR-CU-04: the code is single use, expires on a timer and locks after the
   * configured number of wrong attempts. Attempts accumulate on the row, so
   * simply requesting another code cannot reset the counter and let a caller
   * guess indefinitely.
   */
  async consume(target: string, purpose: OtpPurpose, code: string): Promise<string | null> {
    const config = await readAuthSettings(this.settings);
    const normalised = normaliseTarget(target);
    const rows = await this.prisma.$queryRaw<OtpRow[]>(
      Prisma.sql`SELECT id, user_id, code_hash, attempts, expires_at FROM otp_codes
                 WHERE target = ${normalised} AND purpose = ${purpose}::otp_purpose AND consumed_at IS NULL
                 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
    );
    const row = rows[0];
    if (row === undefined) throw new DomainError('OTP_INVALID', 'Request a new code');
    if (row.attempts >= config.otpMaxAttempts) throw new DomainError('OTP_LOCKED', 'Too many incorrect attempts. Request a new code.');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new DomainError('OTP_INVALID', 'The code has expired. Request a new one.');
    if (row.code_hash !== hashOtpCode(this.secrets.otpPepper, normalised, purpose, code)) {
      const used = row.attempts + 1;
      await this.prisma.$queryRaw(Prisma.sql`UPDATE otp_codes SET attempts = ${used} WHERE id = ${row.id}::uuid`);
      if (used >= config.otpMaxAttempts) throw new DomainError('OTP_LOCKED', 'Too many incorrect attempts. Request a new code.');
      throw new DomainError('OTP_INVALID', `The code is not correct. ${config.otpMaxAttempts - used} attempt(s) remaining`);
    }
    await this.prisma.$queryRaw(Prisma.sql`UPDATE otp_codes SET consumed_at = now() WHERE id = ${row.id}::uuid`);
    return row.user_id;
  }
}
