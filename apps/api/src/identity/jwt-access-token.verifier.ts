import { Inject, Injectable } from '@nestjs/common';
import type { AccessClaims, AccessTokenVerifier } from '../common/access-token.port.js';
import { TOKENS, type AuthSecrets } from './auth-secrets.js';
import { verifyAccessToken } from './tokens.js';

@Injectable()
export class JwtAccessTokenVerifier implements AccessTokenVerifier {
  constructor(@Inject(TOKENS) private readonly secrets: AuthSecrets) {}

  async verify(token: string): Promise<AccessClaims> {
    return verifyAccessToken(token, this.secrets);
  }
}
