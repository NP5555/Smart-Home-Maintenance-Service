import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { POLICY_METADATA_KEY, enforcePolicy, type AuthenticatedPrincipal, type AuthenticatedRequest, type Policy } from '../src/common/policy.js';
import { PolicyGuard } from '../src/common/policy.guard.js';
import { DomainError } from '../src/common/domain-error.js';
import { UnconfiguredAccessTokenVerifier, type AccessTokenVerifier } from '../src/common/access-token.port.js';

const principal = (roles: string[], totpVerified = true): AuthenticatedPrincipal => ({ userId: '00000000-0000-4000-8000-000000000001', sessionId: 'session-1', roles: roles as AuthenticatedPrincipal['roles'], totpVerified });
const requestWith = (value: AuthenticatedPrincipal | undefined): AuthenticatedRequest => ({ principal: value }) as AuthenticatedRequest;

const handler = (): void => undefined;

const executionContext = (policy: Policy | undefined, request: unknown) => ({
  getType: () => 'http',
  getHandler: () => handler,
  getClass: () => class Controller {},
  switchToHttp: () => ({ getRequest: () => request })
});

const guard = (verifier: AccessTokenVerifier = new UnconfiguredAccessTokenVerifier()): PolicyGuard => new PolicyGuard(new Reflector(), verifier);

describe('PolicyGuard', () => {
  it('NFR-SE-02: fails closed when a route declares no policy', async () => {
    const { context } = executionContext(undefined, {});
    await expect(guard().canActivate(context as never)).rejects.toThrow(DomainError);
  });

  it('lets explicitly public routes through without a token', async () => {
    const { context } = executionContext({ public: true }, {});
    await expect(guard().canActivate(context as never)).resolves.toBe(true);
  });

  it('rejects a missing bearer token on a protected route', async () => {
    const { context } = executionContext({ roles: ['ADMIN'] }, { headers: {} });
    await expect(guard().canActivate(context as never)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a token that no adapter can verify while identity is deferred', async () => {
    const { context } = executionContext({ roles: ['ADMIN'] }, { headers: { authorization: 'Bearer whatever' } });
    await expect(guard().canActivate(context as never)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('attaches the principal from the verifier before evaluating roles', async () => {
    const verifier: AccessTokenVerifier = { verify: async () => ({ userId: 'user-1', sessionId: 'session-9', roles: ['ADMIN'], totpVerified: true }) };
    const request: AuthenticatedRequest = { headers: { authorization: 'Bearer good' } } as AuthenticatedRequest;
    const { context } = executionContext({ roles: ['ADMIN'], totpRequired: true }, request);
    await expect(guard(verifier).canActivate(context as never)).resolves.toBe(true);
    expect(request.principal?.roles).toEqual(['ADMIN']);
  });
});

describe('enforcePolicy', () => {
  it('FR-AD-13: allows the declared staff roles and rejects the rest', () => {
    expect(() => enforcePolicy(requestWith(principal(['AGENT'])), { roles: ['AGENT', 'ADMIN'] })).not.toThrow();
    expect(() => enforcePolicy(requestWith(principal(['CUSTOMER'])), { roles: ['ADMIN'] })).toThrow(DomainError);
  });

  it('NFR-SE-07: blocks staff actions before TOTP verification', () => {
    expect(() => enforcePolicy(requestWith(principal(['AGENT'], false)), { roles: ['AGENT'], totpRequired: true })).toThrow(DomainError);
    expect(() => enforcePolicy(requestWith(principal(['AGENT'], false)), { roles: ['AGENT'] })).not.toThrow();
  });

  it('requires authentication for a policy with no roles', () => {
    expect(() => enforcePolicy(requestWith(undefined), {})).toThrow(DomainError);
    expect(() => enforcePolicy(requestWith(principal(['CUSTOMER'])), {})).not.toThrow();
  });
});

describe('global providers', () => {
  it('registers exactly one filter, guard and interceptor', () => {
    expect(APP_FILTER).toBeTypeOf('string');
    expect(APP_GUARD).toBeTypeOf('string');
    expect(APP_INTERCEPTOR).toBeTypeOf('string');
    expect(POLICY_METADATA_KEY).toBe('smart-home:policy');
  });
});
