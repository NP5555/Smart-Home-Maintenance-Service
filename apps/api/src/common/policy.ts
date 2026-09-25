import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DomainError } from './domain-error.js';

export const STAFF_ROLES = ['AGENT', 'FINANCE', 'ADMIN'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ALL_ROLES = ['CUSTOMER', 'PROVIDER', 'AGENT', 'FINANCE', 'ADMIN'] as const;
export type ActorRole = (typeof ALL_ROLES)[number];

export type Policy = { public?: boolean; roles?: readonly ActorRole[]; totpRequired?: boolean };

export const POLICY_METADATA_KEY = 'smart-home:policy';

export type AuthenticatedPrincipal = { userId: string; roles: readonly ActorRole[]; totpVerified: boolean; sessionId: string };

export type AuthenticatedRequest = FastifyRequest & { principal?: AuthenticatedPrincipal };

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(POLICY_METADATA_KEY, { public: true } satisfies Policy);

/** Any signed in user. The role list is intentionally empty. */
export const Authenticated = (roles: readonly ActorRole[] = []): MethodDecorator & ClassDecorator =>
  SetMetadata(POLICY_METADATA_KEY, { roles } satisfies Policy);

export const PolicyDecorator = (policy: Policy): MethodDecorator & ClassDecorator => SetMetadata(POLICY_METADATA_KEY, policy);

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedPrincipal | undefined =>
  context.switchToHttp().getRequest<AuthenticatedRequest>().principal
);

export const enforcePolicy = (request: AuthenticatedRequest, required: Policy): void => {
  if (required.public === true) return;
  const principal = request.principal;
  if (principal === undefined) throw new DomainError('UNAUTHENTICATED', 'Authentication is required');
  if (required.roles !== undefined && required.roles.length > 0 && !required.roles.some(role => principal.roles.includes(role))) {
    throw new DomainError('FORBIDDEN', 'Your role does not grant access to this resource');
  }
  if (required.totpRequired === true && !principal.totpVerified) throw new DomainError('TOTP_REQUIRED', 'Two factor verification is required for staff actions');
};
