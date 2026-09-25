import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { forgotPasswordInputSchema, loginInputSchema, otpRequestInputSchema, otpVerifyInputSchema, registerInputSchema, resetPasswordInputSchema } from '@smart-home/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, PolicyDecorator } from '../common/policy.js';
import { IdentityService } from './identity.service.js';

const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => schema.parse(value);
const csrfInputSchema = z.object({ csrfToken: z.string().min(32) }).strict();

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly identity: IdentityService) {}

  @Post('register')
  @PolicyDecorator({ public: true })
  @ApiOperation({ summary: 'Register a customer or provider pending phone OTP' })
  register(@Body() body: unknown) {
    return this.identity.register(parse(registerInputSchema, body));
  }

  @Post('otp/request')
  @HttpCode(202)
  @PolicyDecorator({ public: true })
  requestOtp(@Body() body: unknown): Promise<string> {
    const input = parse(otpRequestInputSchema, body);
    return this.identity.requestOtp(input.userId, input.purpose);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @PolicyDecorator({ public: true })
  async verifyOtp(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parse(otpVerifyInputSchema, body);
    const result = await this.identity.verifyOtp(input.userId, input.purpose, input.code);
    this.setAuthCookies(reply, result.refreshToken, result.csrfToken);
    const { refreshToken: _refreshToken, csrfToken: _csrfToken, ...output } = result;
    return output;
  }

  @Post('login')
  @HttpCode(200)
  @PolicyDecorator({ public: true })
  async login(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parse(loginInputSchema, body);
    const result = await this.identity.login(input.identifier, input.password, input.totp);
    this.setAuthCookies(reply, result.refreshToken, result.csrfToken);
    const { refreshToken: _refreshToken, csrfToken: _csrfToken, ...output } = result;
    return output;
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth()
  @PolicyDecorator({ public: true })
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = request.cookies.refresh_token;
    if (typeof token !== 'string') return reply.status(401).send({ code: 'UNAUTHENTICATED', detail: 'Refresh cookie is required', errors: [] });
    const csrf = parse(csrfInputSchema, request.body).csrfToken;
    const result = await this.identity.rotateRefresh(token, csrf);
    this.setAuthCookies(reply, result.refreshToken, result.csrfToken);
    return { accessToken: result.accessToken, expiresInSeconds: result.expiresInSeconds };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  @PolicyDecorator({ public: true })
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const token = request.cookies.refresh_token;
    if (typeof token === 'string') await this.identity.logout(token);
    this.clearAuthCookies(reply);
  }

  @Post('password/forgot')
  @HttpCode(202)
  @PolicyDecorator({ public: true })
  forgotPassword(@Body() body: unknown) {
    return this.identity.forgotPassword(parse(forgotPasswordInputSchema, body).identifier);
  }

  @Post('password/reset')
  @HttpCode(204)
  @PolicyDecorator({ public: true })
  async resetPassword(@Body() body: unknown): Promise<void> {
    const input = parse(resetPasswordInputSchema, body);
    await this.identity.resetPassword(input.userId, input.code, input.password);
  }

  @Post('totp/setup')
  @PolicyDecorator({ roles: ['AGENT', 'FINANCE', 'ADMIN'] })
  setupTotp(@CurrentUser() user: { id: string }) {
    return this.identity.setupTotp(user.id);
  }

  @Post('totp/verify')
  @HttpCode(204)
  @PolicyDecorator({ roles: ['AGENT', 'FINANCE', 'ADMIN'] })
  async verifyTotp(@CurrentUser() user: { id: string }, @Body() body: unknown): Promise<void> {
    await this.identity.verifyTotp(user.id, parse(z.object({ code: z.string().regex(/^\d{6}$/) }).strict(), body).code);
  }

  @Get('session')
  @PolicyDecorator({})
  session(@CurrentUser() user: { id: string; roles: string[]; totpVerified: boolean }) {
    return { userId: user.id, roles: user.roles, totpVerified: user.totpVerified };
  }

  private setAuthCookies(reply: FastifyReply, refreshToken: string, csrfToken: string): void {
    const secure = process.env.NODE_ENV === 'production';
    reply.setCookie('refresh_token', refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/api/v1/auth', maxAge: 30 * 86_400 });
    reply.setCookie('csrf_token', csrfToken, { httpOnly: false, secure, sameSite: 'lax', path: '/api/v1/auth', maxAge: 30 * 86_400 });
  }

  private clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie('refresh_token', { path: '/api/v1/auth' });
    reply.clearCookie('csrf_token', { path: '/api/v1/auth' });
  }
}
