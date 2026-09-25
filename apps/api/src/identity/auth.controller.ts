import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Ip, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../common/domain-error.js';
import { Authenticated, CurrentPrincipal, Public, type AuthenticatedPrincipal } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { EnvironmentService } from '../config/environment.service.js';
import { AuthService, type AuthResult } from './auth.service.js';
import {
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordForgotSchema,
  passwordResetSchema,
  registerSchema,
  totpVerifySchema
} from './auth.schemas.js';

export const REFRESH_COOKIE = 'shm_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService
  ) {
    this.secureCookies = this.environment.isProduction;
  }

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Create a customer or provider account and send the phone OTP (FR-CU-01, FR-CU-03, FR-SP-01)' })
  async register(@Body() body: unknown) {
    const input = parseWith(registerSchema, body);
    return this.auth.register(input);
  }

  @Post('otp/request')
  @HttpCode(202)
  @Public()
  @ApiOperation({ summary: 'Send a one time code to a phone or email address' })
  async requestOtp(@Body() body: unknown, @Headers('accept-language') acceptLanguage?: string) {
    const { target, purpose } = parseWith(otpRequestSchema, body);
    const result = await this.auth.requestOtp(target, purpose, this.localeOf(acceptLanguage));
    return { sent: true, purpose, expiresAt: result.expiresAt, resendAfterSeconds: result.resendAfterSeconds };
  }

  @Post('otp/verify')
  @Public()
  @ApiOperation({ summary: 'Redeem a one time code; REGISTER and LOGIN return a session' })
  async verifyOtp(@Body() body: unknown, @Req() request: FastifyRequest, @Ip() ip: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const { target, purpose, code } = parseWith(otpVerifySchema, body);
    const result = await this.auth.verifyOtp(target, purpose, code, this.metaOf(request, ip));
    return this.issue(result, reply);
  }

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Sign in with phone or email and password; staff additionally require TOTP (FR-CU-01, FR-AD-01)' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS, or TOTP_REQUIRED for a staff account' })
  async login(@Body() body: unknown, @Req() request: FastifyRequest, @Ip() ip: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseWith(loginSchema, body);
    return this.issue(await this.auth.login(input, this.metaOf(request, ip)), reply);
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Rotate the refresh cookie; presenting a spent token revokes the whole rotation family' })
  @ApiResponse({ status: 401, description: 'REFRESH_REUSE_DETECTED revokes every session in the family' })
  async refresh(@Req() request: FastifyRequest, @Ip() ip: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const presented = this.cookieOf(request);
    if (presented === undefined) throw new DomainError('UNAUTHENTICATED', 'A refresh token is required');
    return this.issue(await this.auth.refresh(presented, this.metaOf(request, ip)), reply);
  }

  @Post('logout')
  @HttpCode(204)
  @Public()
  @ApiOperation({ summary: 'Revoke the refresh cookie' })
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const presented = this.cookieOf(request);
    if (presented !== undefined) await this.auth.logout(presented);
    this.clearCookie(reply);
  }

  @Post('password/forgot')
  @HttpCode(202)
  @Public()
  @ApiOperation({ summary: 'Send a reset code; the response never reveals whether the account exists (FR-CU-04)' })
  async forgot(@Body() body: unknown, @Headers('accept-language') acceptLanguage?: string) {
    const { identifier } = parseWith(passwordForgotSchema, body);
    return this.auth.requestPasswordReset(identifier, this.localeOf(acceptLanguage));
  }

  @Post('password/reset')
  @Public()
  @ApiOperation({ summary: 'Redeem a reset code, set a new password and sign out every other session (FR-CU-04)' })
  async reset(@Body() body: unknown, @Req() request: FastifyRequest, @Ip() ip: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseWith(passwordResetSchema, body);
    return this.issue(await this.auth.resetPassword(input, this.metaOf(request, ip)), reply);
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed in user with roles and provider status' })
  async me(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined) {
    return { user: await this.auth.describe(this.requirePrincipal(principal)) };
  }

  @Post('totp/setup')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a TOTP secret and provisioning URI; returned exactly once' })
  async totpSetup(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined) {
    return this.auth.beginTotpSetup(this.requirePrincipal(principal));
  }

  @Post('totp/verify')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm the authenticator code and activate TOTP' })
  async totpVerify(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined, @Body() body: unknown) {
    return this.auth.confirmTotpSetup(this.requirePrincipal(principal), parseWith(totpVerifySchema, body));
  }

  @Delete('totp')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Turn TOTP off for the account; live sessions are downgraded until they sign in again' })
  async totpDisable(@CurrentPrincipal() principal: AuthenticatedPrincipal | undefined) {
    return this.auth.disableTotp(this.requirePrincipal(principal));
  }

  /**
   * The refresh token is delivered as an httpOnly cookie scoped to the auth
   * routes (TRD §16) so script cannot read it. The access token stays in the
   * response body for the client to hold in memory only.
   */
  private issue(result: AuthResult, reply: FastifyReply) {
    reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      expires: new Date(result.refreshExpiresAt)
    });
    return {
      user: result.user,
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
      totpRequired: result.totpRequired
    };
  }

  private clearCookie(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: this.secureCookies, sameSite: 'lax', path: REFRESH_COOKIE_PATH });
  }

  private requirePrincipal(principal: AuthenticatedPrincipal | undefined): string {
    if (principal === undefined) throw new DomainError('UNAUTHENTICATED', 'Authentication is required');
    return principal.userId;
  }

  private metaOf(request: FastifyRequest, ip: string): { userAgent?: string | undefined; ip?: string | undefined } {
    const agent = request.headers['user-agent'];
    return { userAgent: agent, ip: ip === '' ? undefined : ip };
  }

  private localeOf(acceptLanguage: string | undefined): string {
    return acceptLanguage?.toLowerCase().startsWith('ur') ? 'ur' : 'en';
  }

  private cookieOf(request: FastifyRequest): string | undefined {
    const raw = request.headers.cookie;
    if (raw === undefined) return undefined;
    for (const part of raw.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      if (part.slice(0, separator).trim() === REFRESH_COOKIE) return decodeURIComponent(part.slice(separator + 1));
    }
    return undefined;
  }
}
