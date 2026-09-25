import { Injectable } from '@nestjs/common';
import { DomainError } from './domain-error.js';
import type { ActorRole } from './policy.js';

export type AccessClaims = { userId: string; sessionId: string; roles: readonly ActorRole[]; totpVerified: boolean };

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessClaims>;
}

@Injectable()
export class UnconfiguredAccessTokenVerifier implements AccessTokenVerifier {
  async verify(): Promise<AccessClaims> {
    throw new DomainError('UNAUTHENTICATED', 'Authentication is not configured in this increment; identity lands in the next one');
  }
}
