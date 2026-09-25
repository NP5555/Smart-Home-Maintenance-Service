import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { authenticator } from 'otplib';
import { EnvironmentService } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.module.js';
import { MockInbox } from '../integrations/mocks.js';
import { DomainError } from '../common/domain-error.js';
import { TokenService } from './token.service.js';

type UserRow = { id: string; phone_e164: string; email: string | null; password_hash: string; first_name: string; last_name: string; locale: 'en' | 'ur'; phone_verified_at: Date | null; totp_secret_enc: Buffer | null; totp_enabled_at: Date | null };
type RoleRow = { role_code: string };
type SessionRow = { id: string; user_id: string; family_id: string; refresh_token_hash: string; expires_at: Date; revoked_at: Date | null };
type UserView = { id: string; firstName: string; lastName: string; locale: string; phoneVerified: boolean; roles: string[] };
export type SessionResult = { user: UserView; accessToken: string; expiresInSeconds: number; refreshToken: string; csrfToken: string };

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly inbox: MockInbox,
    private readonly tokens: TokenService,
    private readonly environment: EnvironmentService
  ) {}

  async register(input: { accountType: 'CUSTOMER' | 'PROVIDER'; phone: string; email?: string | undefined; password: string; firstName: string; lastName: string; locale: 'en' | 'ur' }): Promise<{ userId: string; developmentCode?: string }> {
    const passwordHash = await this.hashPassword(input.password);
    const id = randomUUID();
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`INSERT INTO users(id, phone_e164, email, password_hash, first_name, last_name, locale) VALUES (${id}::uuid, ${input.phone}, ${input.email ?? null}, ${passwordHash}, ${input.firstName}, ${input.lastName}, ${input.locale})`);
        const table = input.accountType === 'CUSTOMER' ? 'customers' : 'providers';
        await tx.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(table)} (user_id${input.accountType === 'PROVIDER' ? Prisma.raw(', status') : Prisma.raw('')}) VALUES (${id}::uuid${input.accountType === 'PROVIDER' ? Prisma.raw(", 'PENDING_APPROVAL'") : Prisma.raw('')})`);
        await tx.$executeRaw(Prisma.sql`INSERT INTO user_roles(user_id, role_code) VALUES (${id}::uuid, ${input.accountType})`);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DomainError('CONFLICT', 'Phone or email is already registered');
      throw error;
    }
    const code = await this.requestOtp(id, 'REGISTER');
    return this.environment.values.NODE_ENV === 'development' ? { userId: id, developmentCode: code } : { userId: id };
  }

  async requestOtp(userId: string, purpose: 'REGISTER' | 'LOGIN' | 'PASSWORD_RESET'): Promise<string> {
    const user = await this.userById(userId);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found');
    const code = await this.issueOtp(userId, purpose);
    const target = purpose === 'PASSWORD_RESET' ? user.email ?? user.phone_e164 : user.phone_e164;
    if (target.includes('@')) await this.inbox.add({ channel: 'EMAIL', recipient: target, subject: `${purpose} verification`, body: `Your code is ${code}`, metadata: { purpose, userId } });
    else await this.inbox.add({ channel: 'SMS', recipient: target, body: `Your code is ${code}`, metadata: { purpose, userId } });
    return code;
  }

  async verifyOtp(userId: string, purpose: 'REGISTER' | 'LOGIN' | 'PASSWORD_RESET', code: string): Promise<SessionResult> {
    await this.consumeOtp(userId, purpose, code);
    if (purpose === 'REGISTER') await this.prisma.$executeRaw(Prisma.sql`UPDATE users SET phone_verified_at = now() WHERE id = ${userId}::uuid`);
    return this.createSession(userId, true, purpose === 'LOGIN');
  }

  async login(identifier: string, password: string, suppliedTotp?: string): Promise<{ user: UserView; accessToken: string; expiresInSeconds: number; refreshToken: string; csrfToken: string }> {
    await this.rateLimit(`login:ip:${identifier}`, 5, 900);
    const user = await this.userByIdentifier(identifier);
    if (!user || !(await this.verifyPassword(user.password_hash, password))) throw new DomainError('INVALID_CREDENTIALS', 'Identifier or password is invalid');
    const roles = await this.roles(user.id);
    const isStaff = roles.some(role => ['AGENT', 'FINANCE', 'ADMIN'].includes(role));
    let totpVerified = false;
    if (isStaff) {
      if (!user.totp_secret_enc || !suppliedTotp) throw new DomainError('TOTP_REQUIRED', 'A valid TOTP code is required for staff login');
      if (!authenticator.verify({ token: suppliedTotp, secret: this.decryptTotp(user.totp_secret_enc) })) throw new DomainError('TOTP_INVALID', 'TOTP code is invalid');
      totpVerified = true;
    }
    return this.createSession(user.id, totpVerified, totpVerified);
  }

  async rotateRefresh(token: string, csrfToken?: string): Promise<{ accessToken: string; refreshToken: string; csrfToken: string; expiresInSeconds: number }> {
    if (!csrfToken || !this.safeEqual(csrfToken, this.hashOpaque(token, this.environment.values.CSRF_SECRET))) throw new DomainError('FORBIDDEN', 'CSRF token is invalid');
    const hash = this.hashOpaque(token, this.environment.values.JWT_REFRESH_SECRET);
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<SessionRow[]>(Prisma.sql`SELECT id, user_id, family_id, refresh_token_hash, expires_at, revoked_at FROM sessions WHERE refresh_token_hash = ${hash} FOR UPDATE`);
      const session = rows[0];
      if (!session || session.expires_at <= new Date()) throw new DomainError('UNAUTHENTICATED', 'Refresh token is invalid or expired');
      if (session.revoked_at) {
        await tx.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = ${session.family_id}::uuid AND revoked_at IS NULL`);
        throw new DomainError('REFRESH_REUSE_DETECTED', 'Refresh token reuse detected; session family revoked');
      }
      const replacement = this.tokens.opaqueToken();
      const csrf = this.tokens.opaqueToken();
      const replacementId = randomUUID();
      await tx.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now(), replaced_by = ${replacementId}::uuid WHERE id = ${session.id}::uuid`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO sessions(id, user_id, family_id, refresh_token_hash, expires_at, replaced_by) VALUES (${replacementId}::uuid, ${session.user_id}::uuid, ${session.family_id}::uuid, ${this.hashOpaque(replacement, this.environment.values.JWT_REFRESH_SECRET)}, ${this.refreshExpiry()}, ${replacementId}::uuid)`);
      const user = await this.userById(session.user_id, tx);
      if (!user) throw new DomainError('UNAUTHENTICATED', 'User no longer exists');
      const roles = await this.roles(user.id, tx);
      const totp = user.totp_enabled_at !== null;
      return { accessToken: await this.tokens.issueAccess({ sub: user.id, roles, totp, sid: replacementId }), refreshToken: replacement, csrfToken: this.hashOpaque(replacement, this.environment.values.CSRF_SECRET), expiresInSeconds: this.environment.values.ACCESS_TOKEN_TTL_MIN * 60 };
    });
  }

  async logout(token: string): Promise<void> {
    const hash = this.hashOpaque(token, this.environment.values.JWT_REFRESH_SECRET);
    await this.prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = ${hash} AND revoked_at IS NULL`);
  }

  async forgotPassword(identifier: string): Promise<{ userId: string; developmentCode?: string }> {
    const user = await this.userByIdentifier(identifier);
    if (!user) return { userId: '00000000-0000-0000-0000-000000000000' };
    await this.rateLimit(`password:${identifier}`, 5, 900);
    const code = await this.requestOtp(user.id, 'PASSWORD_RESET');
    return this.environment.values.NODE_ENV === 'development' ? { userId: user.id, developmentCode: code } : { userId: user.id };
  }

  async resetPassword(userId: string, code: string, password: string): Promise<void> {
    await this.consumeOtp(userId, 'PASSWORD_RESET', code);
    const passwordHash = await this.hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}::uuid`),
      this.prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`)
    ]);
  }

  async setupTotp(userId: string): Promise<{ secret: string; otpauth: string }> {
    const user = await this.userById(userId);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found');
    const secret = authenticator.generateSecret();
    const encrypted = this.encryptTotp(secret);
    await this.prisma.$executeRaw(Prisma.sql`UPDATE users SET totp_secret_enc = ${encrypted}, totp_enabled_at = NULL WHERE id = ${userId}::uuid`);
    return { secret, otpauth: authenticator.keyuri(user.email ?? user.phone_e164, 'Smart Home', secret) };
  }

  async verifyTotp(userId: string, code: string): Promise<void> {
    const user = await this.userById(userId);
    if (!user?.totp_secret_enc) throw new DomainError('TOTP_INVALID', 'TOTP has not been set up');
    if (!authenticator.check(code, this.decryptTotp(user.totp_secret_enc))) throw new DomainError('TOTP_INVALID', 'TOTP code is invalid');
    await this.prisma.$executeRaw(Prisma.sql`UPDATE users SET totp_enabled_at = now() WHERE id = ${userId}::uuid`);
  }

  private async createSession(userId: string, totpVerified: boolean, requireTotp: boolean): Promise<SessionResult> {
    if (requireTotp && !totpVerified) throw new DomainError('TOTP_REQUIRED', 'Staff TOTP is mandatory');
    const user = await this.userById(userId);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'User not found');
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshToken = this.tokens.opaqueToken();
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO sessions(id, user_id, family_id, refresh_token_hash, expires_at) VALUES (${sessionId}::uuid, ${userId}::uuid, ${familyId}::uuid, ${this.hashOpaque(refreshToken, this.environment.values.JWT_REFRESH_SECRET)}, ${this.refreshExpiry()})`);
    const roles = await this.roles(userId);
    return { user: await this.userView(user, roles), accessToken: await this.tokens.issueAccess({ sub: userId, sid: sessionId, roles, totp: totpVerified }), expiresInSeconds: this.environment.values.ACCESS_TOKEN_TTL_MIN * 60, refreshToken, csrfToken: this.hashOpaque(refreshToken, this.environment.values.CSRF_SECRET) };
  }

  private async issueOtp(userId: string, purpose: 'REGISTER' | 'LOGIN' | 'PASSWORD_RESET'): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.rateLimit(`otp:${userId}:${purpose}`, 5, 900);
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO otp_codes(user_id, target, purpose, code_hash, expires_at) SELECT id, phone_e164, ${purpose}::otp_purpose, ${this.hashOtp(code)}, now() + interval '10 minutes' FROM users WHERE id = ${userId}::uuid`);
    return code;
  }

  private async consumeOtp(userId: string, purpose: 'REGISTER' | 'LOGIN' | 'PASSWORD_RESET', code: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: string; code_hash: string; attempts: number; expires_at: Date; consumed_at: Date | null }[]>(Prisma.sql`SELECT id, code_hash, attempts, expires_at, consumed_at FROM otp_codes WHERE user_id = ${userId}::uuid AND purpose = ${purpose}::otp_purpose AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
    const otp = rows[0];
    if (!otp || otp.expires_at <= new Date() || otp.attempts >= 5 || !this.safeEqual(otp.code_hash, this.hashOtp(code))) {
      if (otp) await this.prisma.$executeRaw(Prisma.sql`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otp.id}::uuid`);
      throw new DomainError(otp?.attempts === 4 ? 'OTP_LOCKED' : 'OTP_INVALID', 'OTP is invalid, expired, or locked');
    }
    await this.prisma.$executeRaw(Prisma.sql`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}::uuid`);
  }

  private async userById(id: string, client: PrismaService | Prisma.TransactionClient = this.prisma): Promise<UserRow | null> {
    return (await client.$queryRaw<UserRow[]>(Prisma.sql`SELECT id, phone_e164, email, password_hash, first_name, last_name, locale, phone_verified_at, totp_secret_enc, totp_enabled_at FROM users WHERE id = ${id}::uuid`))[0] ?? null;
  }

  private async userByIdentifier(identifier: string): Promise<UserRow | null> {
    return (await this.prisma.$queryRaw<UserRow[]>(Prisma.sql`SELECT id, phone_e164, email, password_hash, first_name, last_name, locale, phone_verified_at, totp_secret_enc, totp_enabled_at FROM users WHERE phone_e164 = ${identifier} OR email = ${identifier} LIMIT 1`))[0] ?? null;
  }

  private async roles(userId: string, client: PrismaService | Prisma.TransactionClient = this.prisma): Promise<string[]> {
    return (await client.$queryRaw<RoleRow[]>(Prisma.sql`SELECT role_code FROM user_roles WHERE user_id = ${userId}::uuid ORDER BY role_code`)).map(row => row.role_code);
  }

  private async userView(user: UserRow, roles: string[]): Promise<UserView> {
    return { id: user.id, firstName: user.first_name, lastName: user.last_name, locale: user.locale, phoneVerified: user.phone_verified_at !== null, roles };
  }

  private async rateLimit(key: string, limit: number, seconds: number): Promise<void> {
    const count = await this.redis.client.incr(`rate:${key}`);
    if (count === 1) await this.redis.client.expire(`rate:${key}`, seconds);
    if (count > limit) throw new DomainError('RATE_LIMITED', 'Too many attempts');
  }

  private async hashPassword(password: string): Promise<string> {
    return (await import('argon2')).hash(password, { type: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  private verifyPassword(hash: string, password: string): Promise<boolean> {
    return import('argon2').then(argon2 => argon2.verify(hash, password));
  }

  private hashOtp(code: string): string {
    return createHmac('sha256', this.environment.values.OTP_PEPPER).update(code).digest('hex');
  }

  private hashOpaque(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.environment.values.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  private encryptTotp(secret: string): Buffer {
    const key = Buffer.from(this.environment.values.TOTP_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must decode to 32 bytes');
    const iv = randomUUID().replaceAll('-', '').slice(0, 12);
    const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(iv));
    return Buffer.concat([Buffer.from(iv), cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  }

  private decryptTotp(value: Buffer): string {
    const key = Buffer.from(this.environment.values.TOTP_ENCRYPTION_KEY, 'base64');
    const iv = value.subarray(0, 12);
    const tag = value.subarray(value.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(value.subarray(12, value.length - 16)), decipher.final()]).toString('utf8');
  }
}

export const userIdHash = (userId: string): string => createHash('sha256').update(userId).digest('hex');
