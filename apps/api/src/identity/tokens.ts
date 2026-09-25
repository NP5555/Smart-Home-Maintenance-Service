import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AccessClaims } from '../common/access-token.port.js';
import { DomainError } from '../common/domain-error.js';
import type { ActorRole } from '../common/policy.js';

export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_BYTES = 32;

export type TokenSecrets = {
  accessSecret: string;
  refreshSecret: string;
  issuer: string;
  audience: string;
  accessTtlMinutes: number;
  refreshTtlDays: number;
};

export type IssuedRefreshToken = { token: string; hash: string; expiresAt: Date };

const encoder = new TextEncoder();

const accessKey = (secrets: TokenSecrets): Uint8Array => encoder.encode(secrets.accessSecret);

export const signAccessToken = async (claims: AccessClaims, secrets: TokenSecrets): Promise<string> =>
  new SignJWT({ sid: claims.sessionId, roles: claims.roles, totp: claims.totpVerified, typ: ACCESS_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(secrets.issuer)
    .setAudience(secrets.audience)
    .setIssuedAt()
    .setExpirationTime(`${secrets.accessTtlMinutes}m`)
    .sign(accessKey(secrets));

export const verifyAccessToken = async (token: string, secrets: TokenSecrets): Promise<AccessClaims> => {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, accessKey(secrets), { issuer: secrets.issuer, audience: secrets.audience, algorithms: ['HS256'] }));
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === 'ERR_JWT_EXPIRED') throw new DomainError('UNAUTHENTICATED', 'The access token has expired');
    throw new DomainError('UNAUTHENTICATED', 'The access token is not valid');
  }
  if (payload.typ !== ACCESS_TOKEN_TYPE) throw new DomainError('UNAUTHENTICATED', 'The token is not an access token');
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is ActorRole => typeof role === 'string') : [];
  return {
    userId: payload.sub ?? '',
    sessionId: typeof payload.sid === 'string' ? payload.sid : '',
    roles,
    totpVerified: payload.totp === true
  };
};

/**
 * Refresh tokens are opaque random strings rather than JWTs: a rotation family
 * is tracked in the sessions table, so the token itself only needs to be a
 * high-entropy, lookup-able secret. Only its SHA-256 digest is stored.
 */
export const issueRefreshToken = (secrets: TokenSecrets): IssuedRefreshToken => {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  return {
    token,
    hash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + secrets.refreshTtlDays * 86_400_000)
  };
};

export const hashRefreshToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

export const refreshTokenMatches = (candidate: string, storedHash: string): boolean => {
  const a = Buffer.from(hashRefreshToken(candidate), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
};
