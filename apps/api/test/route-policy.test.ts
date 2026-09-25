import { describe, expect, it } from 'vitest';
import { policy } from '../src/common/policy.js';
import { DomainError } from '../src/common/domain-error.js';

const request = (roles: string[], totp = true) => ({ user: { id: '00000000-0000-4000-8000-000000000001', roles, totpVerified: totp } }) as never;

describe('route policies', () => {
  it('FR-AD-13: allows declared staff roles and rejects others', () => {
    expect(() => policy(request(['AGENT']), { roles: ['AGENT', 'ADMIN'] })).not.toThrow();
    expect(() => policy(request(['CUSTOMER']), { roles: ['ADMIN'] })).toThrow(DomainError);
  });

  it('NFR-SE-07: blocks staff before TOTP verification', () => {
    expect(() => policy(request(['AGENT'], false), { roles: ['AGENT'], totpRequired: true })).toThrow(DomainError);
  });

  it('allows explicitly public routes', () => {
    expect(() => policy({} as never, { public: true })).not.toThrow();
  });
});
