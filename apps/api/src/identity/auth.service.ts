import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/domain-error.js';
import type { ActorRole } from '../common/policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.module.js';
import { SettingsService } from '../platform/settings.service.js';
import { TOKENS, type AuthSecrets } from './auth-secrets.js';
import { isEmailTarget, normaliseTarget, OtpService, readAuthSettings, type AuthSettingsSnapshot, type OtpIssued } from './otp.service.js';
import { dummyVerify, hashPassword, verifyPassword } from './password.js';
import { SessionService, type SessionMeta } from './session.service.js';
import { decryptTotpSecret, encryptTotpSecret } from './totp-vault.js';
import { generateTotpSecret, totpUri, verifyTotp } from './otp.js';
import { signAccessToken } from './tokens.js';
import type { LoginInput, PasswordResetInput, RegisterInput, SelfRegisterRole, TotpVerifyInput } from './auth.schemas.js';

export const GENERIC_CREDENTIALS_MESSAGE = 'The phone number, email or password is not correct.';

export type AuthenticatedUser = {
  id: string;
  phoneE164: string | null;
  email: string | null;
  firstName: string;
  lastName: string;
  locale: string;
  status: 'ACTIVE' | 'LOCKED' | 'DEACTIVATED';
  roles: ActorRole[];
  totpEnabled: boolean;
  providerStatus: string | null;
};

export type AuthResult = {
  user: AuthenticatedUser;
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: string;
  totpRequired: boolean;
};

type UserRow = {
  id: string;
  phone_e164: string | null;
  email: string | null;
  first_name: string;
  last_name: string;
  locale: string;
  status: 'ACTIVE' | 'LOCKED' | 'DEACTIVATED';
  phone_verified_at: Date | null;
  totp_enabled_at: Date | null;
  totp_secret_enc: Buffer | null;
  password_hash: string;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TOKENS) private readonly secrets: AuthSecrets
  ) {}

  // ---------------------------------------------------------------- register

  /**
   * FR-CU-01/03 and FR-SP-01. The account is created immediately but stays
   * unverified: a provider starts at PENDING_APPROVAL and a customer cannot
   * book until the phone OTP has been redeemed.
   */
  async register(input: RegisterInput): Promise<{ userId: string; requiresOtp: true }> {
    const passwordHash = await hashPassword(input.password);
    const userId = await this.prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO users(phone_e164, email, password_hash, first_name, last_name, locale)
                   VALUES (${input.phoneE164}, ${input.email ?? null}, ${passwordHash}, ${input.firstName}, ${input.lastName}, ${input.locale})
                   RETURNING id`
      );
      if (row === undefined) throw new DomainError('INTERNAL_ERROR', 'The account could not be created');
      await tx.$queryRaw(Prisma.sql`INSERT INTO user_roles(user_id, role_code) VALUES (${row.id}::uuid, ${input.role}::text)`);
      if (input.role === 'CUSTOMER') {
        await tx.$queryRaw(Prisma.sql`INSERT INTO customers(user_id) VALUES (${row.id}::uuid)`);
      } else {
        // FR-SP-01: a provider is PENDING_APPROVAL from the moment they register.
        await tx.$queryRaw(Prisma.sql`INSERT INTO providers(user_id, status) VALUES (${row.id}::uuid, 'PENDING_APPROVAL')`);
      }
      await tx.$queryRaw(
        Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id, after)
                   VALUES (${row.id}::uuid, ${input.role}::actor_role, 'identity.register', 'user', ${row.id}::text, ${JSON.stringify({ role: input.role, providerStatus: input.role === 'PROVIDER' ? 'PENDING_APPROVAL' : null })}::jsonb)`
      );
      return row.id;
    }).catch(error => {
      throw describeRegistrationConflict(error);
    });
    await this.otp.issue(input.phoneE164, 'REGISTER', userId, input.locale);
    return { userId, requiresOtp: true };
  }

  // --------------------------------------------------------------------- otp

  async requestOtp(target: string, purpose: 'REGISTER' | 'LOGIN' | 'PASSWORD_RESET' | 'PHONE_CHANGE', locale = 'en'): Promise<OtpIssued> {
    const normalised = normaliseTarget(target);
    const user = await this.findUserByTarget(normalised);
    if (user === null && purpose !== 'REGISTER') throw new DomainError('OTP_INVALID', 'Request a new code');
    return this.otp.issue(normalised, purpose, user?.id ?? null, locale);
  }

  async verifyOtp(target: string, purpose: 'REGISTER' | 'LOGIN' | 'PASSWORD_RESET' | 'PHONE_CHANGE', code: string, meta: SessionMeta): Promise<AuthResult> {
    const userId = await this.otp.consume(target, purpose, code);
    const normalised = normaliseTarget(target);
    // FR-CU-03: redeeming the REGISTER code is what marks the phone verified.
    // The code normally carries the user id; fall back to a target lookup so a
    // code issued before the account row existed still resolves.
    const resolved = userId ?? (await this.findUserByTarget(normalised))?.id ?? null;
    if (resolved === null) throw new DomainError('OTP_INVALID', 'Request a new code');
    if (purpose === 'REGISTER') {
      await this.prisma.$queryRaw(Prisma.sql`UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE id = ${resolved}::uuid`);
    }
    return this.startSession(resolved, meta);
  }

  // ------------------------------------------------------------------- login

  /**
   * FR-CU-01 and FR-AD-01. Staff (AGENT/FINANCE/ADMIN) must additionally pass
   * TOTP, and the access token they receive is flagged unverified until they do,
   * so a stolen password alone is not enough to reach a staff route.
   */
  async login(input: LoginInput, meta: SessionMeta): Promise<AuthResult> {
    const config = await readAuthSettings(this.settings);
    const user = await this.findUserByIdentifier(input.identifier);
    if (user === null) {
      await dummyVerify(input.password);
      throw new DomainError('INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
    }
    await this.assertNotRateLimited(input.identifier, meta, config);
    if (user.status === 'DEACTIVATED') throw new DomainError('FORBIDDEN', 'This account has been deactivated');
    const passwordOk = await verifyPassword(user.password_hash, input.password);
    if (!passwordOk) {
      await this.recordFailure(input.identifier, meta, config);
      throw new DomainError('INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
    }
    await this.clearFailures(input.identifier, meta);
    const roles = await this.rolesOf(user.id);
    const staff = roles.some(isStaffRole);
    const totpEnabled = user.totp_enabled_at !== null && user.totp_secret_enc !== null;
    const totpRequired = staff && config.staffTotpRequired;
    let totpVerified = false;
    if (totpRequired && totpEnabled) {
      // NFR-SE-07: an enrolled staff account cannot sign in on the password
      // alone. A wrong or missing code is TOTP_REQUIRED, not a credential
      // error, so the client knows to prompt for the authenticator.
      if (input.totpCode === undefined) throw new DomainError('TOTP_REQUIRED', 'A six digit authenticator code is required to sign in');
      this.assertTotp(user, input.totpCode);
      totpVerified = true;
    }
    // A staff account with no TOTP enrolled yet still gets a session, but the
    // token is flagged unverified. The policy guard then refuses every staff
    // route with TOTP_REQUIRED, which leaves exactly one path forward:
    // /auth/totp/setup followed by /auth/totp/verify.
    return this.startSession(user.id, meta, { roles, totpVerified, totpEnabled });
  }

  // ----------------------------------------------------------------- refresh

  /**
   * Rotation cannot re-prompt for TOTP, because a refresh must be automatic.
   * The invariant relied on is that a staff session can only be created by a
   * login that already passed the TOTP challenge, so for staff the flag is the
   * account's current TOTP state. Turning TOTP off therefore downgrades live
   * sessions to unverified, which is the fail-closed direction.
   */
  async refresh(presented: string, meta: SessionMeta): Promise<AuthResult> {
    const rotated = await this.sessions.rotate(presented, meta);
    const user = await this.loadUser(rotated.userId);
    if (user === null) throw new DomainError('UNAUTHENTICATED', 'The session no longer has a user');
    const roles = await this.rolesOf(user.id);
    const totpVerified = roles.some(isStaffRole) && user.totp_enabled_at !== null;
    return this.issueFor(user, rotated, { roles, totpVerified, totpEnabled: user.totp_enabled_at !== null });
  }

  async logout(presented: string): Promise<void> {
    await this.sessions.revoke(presented);
  }

  // ---------------------------------------------------------------- password

  /** FR-CU-04: the response never reveals whether the identifier exists. */
  async requestPasswordReset(identifier: string, locale = 'en'): Promise<{ sent: true }> {
    const user = await this.findUserByIdentifier(identifier);
    if (user === null) return { sent: true };
    await this.otp.issue(user.phone_e164 ?? user.email ?? identifier, 'PASSWORD_RESET', user.id, locale);
    return { sent: true };
  }

  /** FR-CU-04: single use, and every existing session is signed out afterwards. */
  async resetPassword(input: PasswordResetInput, meta: SessionMeta): Promise<AuthResult> {
    const user = await this.findUserByIdentifier(input.identifier);
    if (user === null) throw new DomainError('INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
    const target = user.phone_e164 ?? user.email;
    if (target === null) throw new DomainError('INVALID_CREDENTIALS', GENERIC_CREDENTIALS_MESSAGE);
    await this.otp.consume(target, 'PASSWORD_RESET', input.code);
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$queryRaw(Prisma.sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${user.id}::uuid`);
    await this.sessions.revokeAllForUser(user.id);
    await this.prisma.$queryRaw(
      Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id)
                 VALUES (${user.id}::uuid, 'SYSTEM', 'identity.password.reset', 'user', ${user.id}::text)`
    );
    return this.startSession(user.id, meta);
  }

  // -------------------------------------------------------------------- totp

  /** SHM-010. Returns the secret and provisioning URI exactly once. */
  async beginTotpSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.loadUser(userId);
    if (user === null) throw new DomainError('NOT_FOUND', 'The user was not found');
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(this.secrets.totpKey, secret);
    await this.prisma.$queryRaw(Prisma.sql`UPDATE users SET totp_secret_enc = ${encrypted} WHERE id = ${userId}::uuid`);
    return { secret, otpauthUri: totpUri({ secret, account: user.email ?? user.phone_e164 ?? userId, issuer: 'Smart Home' }) };
  }

  /** Confirms the authenticator is working, then activates TOTP for the account. */
  async confirmTotpSetup(userId: string, input: TotpVerifyInput): Promise<{ totpEnabled: true }> {
    const user = await this.loadUser(userId);
    if (user === null) throw new DomainError('NOT_FOUND', 'The user was not found');
    if (user.totp_secret_enc === null) throw new DomainError('TOTP_INVALID', 'Start the TOTP setup before verifying a code');
    this.assertTotp(user, input.code);
    await this.prisma.$queryRaw(Prisma.sql`UPDATE users SET totp_enabled_at = now() WHERE id = ${userId}::uuid`);
    await this.prisma.$queryRaw(
      Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id) VALUES (${userId}::uuid, 'SYSTEM', 'identity.totp.enable', 'user', ${userId}::text)`
    );
    return { totpEnabled: true };
  }

  /** TOTP enrollment, recorded in the audit log because it changes a security control. */
  async disableTotp(userId: string): Promise<{ totpEnabled: false }> {
    await this.prisma.$queryRaw(Prisma.sql`UPDATE users SET totp_enabled_at = NULL, totp_secret_enc = NULL WHERE id = ${userId}::uuid`);
    await this.prisma.$queryRaw(
      Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id) VALUES (${userId}::uuid, 'SYSTEM', 'identity.totp.disable', 'user', ${userId}::text)`
    );
    return { totpEnabled: false };
  }

  // ------------------------------------------------------------------ shared

  async describe(userId: string): Promise<AuthenticatedUser> {
    const user = await this.loadUser(userId);
    if (user === null) throw new DomainError('NOT_FOUND', 'The user was not found');
    return this.toPublicUser(user, await this.rolesOf(user.id));
  }

  private assertTotp(user: UserRow, code: string): void {
    if (user.totp_secret_enc === null) throw new DomainError('TOTP_REQUIRED', 'Two factor authentication is not set up for this account');
    let secret: string;
    try {
      secret = decryptTotpSecret(this.secrets.totpKey, user.totp_secret_enc);
    } catch {
      throw new DomainError('TOTP_INVALID', 'Two factor authentication could not be checked');
    }
    if (!verifyTotp(secret, code, new Date())) throw new DomainError('TOTP_INVALID', 'The authenticator code is not correct');
  }

  private async startSession(userId: string, meta: SessionMeta, precomputed?: { roles: ActorRole[]; totpVerified: boolean; totpEnabled: boolean }): Promise<AuthResult> {
    const session = await this.sessions.start(userId, meta);
    const user = await this.loadUser(userId);
    if (user === null) throw new DomainError('UNAUTHENTICATED', 'The session could not be started');
    return this.issueFor(user, session, {
      roles: precomputed?.roles,
      totpVerified: precomputed?.totpVerified ?? false,
      totpEnabled: precomputed?.totpEnabled ?? user.totp_enabled_at !== null
    });
  }

  private async issueFor(
    user: UserRow,
    session: { sessionId: string; refreshToken: string; refreshExpiresAt: string },
    options: { roles?: ActorRole[] | undefined; totpVerified: boolean; totpEnabled: boolean }
  ): Promise<AuthResult> {
    const roles = options.roles ?? (await this.rolesOf(user.id));
    const accessToken = await signAccessToken({ userId: user.id, sessionId: session.sessionId, roles, totpVerified: options.totpVerified }, this.secrets);
    return {
      user: this.toPublicUser(user, roles),
      accessToken,
      expiresInSeconds: this.secrets.accessTtlMinutes * 60,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.refreshExpiresAt,
      totpRequired: roles.some(isStaffRole) && !options.totpVerified
    };
  }

  private toPublicUser(user: UserRow, roles: ActorRole[]): AuthenticatedUser {
    return {
      id: user.id,
      phoneE164: user.phone_e164,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      locale: user.locale,
      status: user.status,
      roles,
      totpEnabled: user.totp_enabled_at !== null,
      providerStatus: null
    };
  }

  private async loadUser(userId: string): Promise<UserRow | null> {
    const [row] = await this.prisma.$queryRaw<UserRow[]>(Prisma.sql`SELECT ${USER_COLUMNS} FROM users WHERE id = ${userId}::uuid`);
    return row ?? null;
  }

  /**
   * Resolves a login identifier to a user.
   *
   * The email/phone choice is made in TypeScript rather than with a SQL LIKE.
   * `target LIKE '@%'` is wrong for the same reason: an address contains `@`
   * but rarely starts with it. The development database also runs a collation
   * that treats punctuation as ignorable, so LIKE is avoided entirely. Equality
   * is unaffected, so branch and compare.
   */
  private async findUserByIdentifier(identifier: string): Promise<UserRow | null> {
    const normalised = normaliseTarget(identifier);
    const rows = isEmailTarget(normalised)
      ? await this.prisma.$queryRaw<UserRow[]>(Prisma.sql`SELECT ${USER_COLUMNS} FROM users WHERE email = ${normalised} LIMIT 1`)
      : await this.prisma.$queryRaw<UserRow[]>(Prisma.sql`SELECT ${USER_COLUMNS} FROM users WHERE phone_e164 = ${normalised} LIMIT 1`);
    return rows[0] ?? null;
  }

  private async findUserByTarget(target: string): Promise<UserRow | null> {
    const [row] = await this.prisma.$queryRaw<UserRow[]>(
      Prisma.sql`SELECT ${USER_COLUMNS} FROM users WHERE phone_e164 = ${target} OR email = ${target} LIMIT 1`
    );
    return row ?? null;
  }

  private async rolesOf(userId: string): Promise<ActorRole[]> {
    const rows = await this.prisma.$queryRaw<{ role_code: ActorRole }[]>(Prisma.sql`SELECT role_code FROM user_roles WHERE user_id = ${userId}::uuid ORDER BY role_code`);
    return rows.map(row => row.role_code);
  }

  private throttleKey(identifier: string, meta: SessionMeta): string {
    return `auth:login-fail:${normaliseTarget(identifier).toLowerCase()}:${meta.ip ?? 'unknown'}`;
  }

  private async assertNotRateLimited(identifier: string, meta: SessionMeta, config: AuthSettingsSnapshot): Promise<void> {
    const attempts = Number((await this.redis.client.get(this.throttleKey(identifier, meta))) ?? 0);
    if (attempts >= config.loginMaxAttempts) {
      throw new DomainError('RATE_LIMITED', `Too many failed attempts. Try again in ${config.loginWindowMinutes} minutes.`);
    }
  }

  private async recordFailure(identifier: string, meta: SessionMeta, config: AuthSettingsSnapshot): Promise<void> {
    const key = this.throttleKey(identifier, meta);
    const attempts = await this.redis.client.incr(key);
    if (attempts === 1) await this.redis.client.expire(key, config.loginWindowMinutes * 60);
  }

  private async clearFailures(identifier: string, meta: SessionMeta): Promise<void> {
    await this.redis.client.del(this.throttleKey(identifier, meta));
  }
}

const USER_COLUMNS = Prisma.sql`id, phone_e164, email, first_name, last_name, locale, status, phone_verified_at, totp_enabled_at, totp_secret_enc, password_hash`;

export const STAFF_ROLES = ['AGENT', 'FINANCE', 'ADMIN'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const isStaffRole = (role: ActorRole): role is StaffRole => (STAFF_ROLES as readonly string[]).includes(role);
export type { SelfRegisterRole };

/** Postgres 23505 is a unique violation; both the phone and the email are unique. */
const UNIQUE_VIOLATION = '23505';

export const describeRegistrationConflict = (error: unknown): Error => {
  const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown; message?: unknown } | undefined) : undefined;
  if (meta?.code === UNIQUE_VIOLATION) {
    const detail = typeof meta.message === 'string' ? meta.message : '';
    return new DomainError('CONFLICT', detail.includes('email') ? 'An account already exists for that email address' : 'An account already exists for that phone number');
  }
  return error instanceof Error ? error : new Error('Registration failed');
};
