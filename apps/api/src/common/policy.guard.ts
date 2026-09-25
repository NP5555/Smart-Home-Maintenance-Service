import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { DomainError } from './domain-error.js';
import { POLICY_KEY, policy, type Policy } from './policy.js';
import { TokenService } from '../identity/token.service.js';

export type AuthenticatedRequest = FastifyRequest & { user?: { id: string; roles: string[]; totpVerified: boolean; sessionId: string } };

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Policy | undefined>(POLICY_KEY, [context.getHandler(), context.getClass()]);
    if (!required) throw new DomainError('INTERNAL_ERROR', 'Route has no policy declaration');
    if (required.public) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new DomainError('UNAUTHENTICATED', 'Bearer access token is required');
    try {
      const claims = await this.tokens.verifyAccess(authorization.slice(7));
      request.user = { id: claims.sub, roles: claims.roles, totpVerified: claims.totp, sessionId: claims.sid };
      policy(request, required);
      return true;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('UNAUTHENTICATED', 'Access token is invalid or expired');
    }
  }
}
