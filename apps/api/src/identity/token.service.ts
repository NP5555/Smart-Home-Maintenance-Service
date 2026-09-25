import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EnvironmentService } from '../config/environment.js';
import { jwtVerify, SignJWT } from 'jose';

export type AccessClaims = { sub: string; sid: string; roles: string[]; totp: boolean };

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;

  constructor(environment: EnvironmentService) {
    this.secret = new TextEncoder().encode(environment.values.JWT_ACCESS_SECRET);
  }

  async issueAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ roles: claims.roles, sid: claims.sid, totp: claims.totp })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer('smart-home-api')
      .setAudience('smart-home-clients')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(this.secret);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const result = await jwtVerify(token, this.secret, { issuer: 'smart-home-api', audience: 'smart-home-clients' });
    if (!result.payload.sub || typeof result.payload.sid !== 'string' || !Array.isArray(result.payload.roles) || typeof result.payload.totp !== 'boolean') throw new Error('Invalid claims');
    return { sub: result.payload.sub, sid: result.payload.sid, roles: result.payload.roles.filter((role): role is string => typeof role === 'string'), totp: result.payload.totp };
  }

  opaqueToken(): string {
    return `${randomUUID()}.${randomUUID()}`;
  }
}
