import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DomainError } from './domain-error.js';

export const staffRoles = ['AGENT', 'FINANCE', 'ADMIN'] as const;
export type StaffRole = typeof staffRoles[number];
export type Policy = { public?: boolean; roles?: StaffRole[]; totpRequired?: boolean };

export const POLICY_KEY = 'policy';
export const PolicyDecorator = (policy: Policy) => SetMetadata(POLICY_KEY, policy);
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<FastifyRequest & { user?: { id: string; roles: string[]; totpVerified: boolean } }>();
  return request.user;
});

export const policy = (request: FastifyRequest & { user?: { roles: string[]; totpVerified: boolean } }, required?: Policy): void => {
  if (required?.public) return;
  if (!request.user) throw new DomainError('UNAUTHENTICATED', 'Authentication is required');
  if (required?.roles && !required.roles.some(role => request.user?.roles.includes(role))) throw new DomainError('FORBIDDEN', 'Role does not grant this policy');
  if (required?.totpRequired && !request.user.totpVerified) throw new DomainError('TOTP_REQUIRED', 'TOTP verification is required');
};
