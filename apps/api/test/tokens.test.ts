import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/common/domain-error.js';
import { ACCESS_TOKEN_TYPE, hashRefreshToken, issueRefreshToken, refreshTokenMatches, signAccessToken, verifyAccessToken, type TokenSecrets } from '../src/identity/tokens.js';

const secrets: TokenSecrets = {
  accessSecret: 'a'.repeat(48),
  refreshSecret: 'b'.repeat(48),
  issuer: 'smart-home-api',
  audience: 'smart-home-clients',
  accessTtlMinutes: 15,
  refreshTtlDays: 30
};

const claims = { userId: '00000000-0000-4000-8000-000000000001', sessionId: '11111111-1111-4111-8111-111111111111', roles: ['ADMIN'] as const, totpVerified: true };

describe('access tokens', () => {
  it('round trips the claims the policy guard depends on', async () => {
    const token = await signAccessToken({ ...claims, roles: ['CUSTOMER', 'PROVIDER'] }, secrets);
    const verified = await verifyAccessToken(token, secrets);
    expect(verified).toEqual({ userId: claims.userId, sessionId: claims.sessionId, roles: ['CUSTOMER', 'PROVIDER'], totpVerified: true });
  });

  it('records the token type so a refresh token cannot be replayed as an access token', async () => {
    const token = await signAccessToken(claims, secrets);
    const [header, payload] = token.split('.');
    const decode = (segment: string): Record<string, unknown> => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(decode(header!).typ).toBe('JWT');
    expect(decode(header!).alg).toBe('HS256');
    expect(decode(payload!).typ).toBe(ACCESS_TOKEN_TYPE);
    expect(decode(payload!).sub).toBe(claims.userId);
  });

  it('rejects a token signed with a different secret, issuer or audience', async () => {
    const token = await signAccessToken(claims, secrets);
    await expect(verifyAccessToken(token, { ...secrets, accessSecret: 'z'.repeat(48) })).rejects.toThrow(DomainError);
    await expect(verifyAccessToken(token, { ...secrets, issuer: 'other' })).rejects.toThrow(DomainError);
    await expect(verifyAccessToken(token, { ...secrets, audience: 'other' })).rejects.toThrow(DomainError);
  });

  it('rejects an unsigned "none" algorithm token and malformed input', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: claims.userId, typ: ACCESS_TOKEN_TYPE })).toString('base64url');
    await expect(verifyAccessToken(`${header}.${body}.`, secrets)).rejects.toThrow(DomainError);
    await expect(verifyAccessToken('not-a-token', secrets)).rejects.toThrow(DomainError);
    await expect(verifyAccessToken('', secrets)).rejects.toThrow(DomainError);
  });

  it('reports an expired token distinctly from an invalid one', async () => {
    const expired = await signAccessToken(claims, { ...secrets, accessTtlMinutes: -1 });
    await expect(verifyAccessToken(expired, secrets)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verifyAccessToken(expired, secrets)).rejects.toMatchObject({ response: { detail: 'The access token has expired' } });
    await expect(verifyAccessToken('nonsense', secrets)).rejects.toMatchObject({ response: { detail: 'The access token is not valid' } });
  });

  it('preserves a false totp flag rather than defaulting it to true', async () => {
    const token = await signAccessToken({ ...claims, totpVerified: false }, secrets);
    expect((await verifyAccessToken(token, secrets)).totpVerified).toBe(false);
  });
});

describe('refresh tokens', () => {
  it('issues a high entropy opaque token and only exposes its digest', () => {
    const issued = issueRefreshToken(secrets);
    expect(issued.token).not.toBe(issued.hash);
    expect(issued.hash).toBe(hashRefreshToken(issued.token));
    expect(issued.token.length).toBeGreaterThanOrEqual(40);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => issueRefreshToken(secrets).token));
    expect(tokens.size).toBe(500);
  });

  it('matches only the token that produced the stored hash', () => {
    const issued = issueRefreshToken(secrets);
    expect(refreshTokenMatches(issued.token, issued.hash)).toBe(true);
    expect(refreshTokenMatches(issueRefreshToken(secrets).token, issued.hash)).toBe(false);
    expect(refreshTokenMatches(issued.token, 'deadbeef')).toBe(false);
    expect(refreshTokenMatches('', '')).toBe(false);
  });

  it('expires refresh tokens at the configured horizon', () => {
    const days = 7;
    const issued = issueRefreshToken({ ...secrets, refreshTtlDays: days });
    const expected = Date.now() + days * 86_400_000;
    expect(Math.abs(issued.expiresAt.getTime() - expected)).toBeLessThan(5_000);
  });
});
