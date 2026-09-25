import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from './domain-error.js';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from './access-token.port.js';
import { POLICY_METADATA_KEY, enforcePolicy, type AuthenticatedRequest, type Policy } from './policy.js';

export const POLICY_REQUIRED_MESSAGE = 'Route is missing a @Policy() or @Public() declaration';

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly tokens: AccessTokenVerifier
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Policy | undefined>(POLICY_METADATA_KEY, [context.getHandler(), context.getClass()]);
    if (required === undefined) throw new DomainError('INTERNAL_ERROR', POLICY_REQUIRED_MESSAGE);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (required.public === true) return true;
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) throw new DomainError('UNAUTHENTICATED', 'A bearer access token is required');
    const claims = await this.tokens.verify(header.slice('Bearer '.length).trim());
    request.principal = { userId: claims.userId, sessionId: claims.sessionId, roles: claims.roles, totpVerified: claims.totpVerified };
    enforcePolicy(request, required);
    return true;
  }
}
