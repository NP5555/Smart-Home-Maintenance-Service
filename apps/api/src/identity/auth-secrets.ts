import type { Provider } from '@nestjs/common';
import { EnvironmentService } from '../config/environment.service.js';
import type { TokenSecrets } from './tokens.js';

export const TOKENS = 'AUTH_SECRETS';

export type AuthSecrets = TokenSecrets & { otpPepper: string; totpKey: Buffer };

export const authSecretsFrom = (environment: EnvironmentService): AuthSecrets => {
  const { values } = environment;
  const totpKey = Buffer.from(values.TOTP_ENCRYPTION_KEY, 'base64');
  if (totpKey.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return {
    accessSecret: values.JWT_ACCESS_SECRET,
    refreshSecret: values.JWT_REFRESH_SECRET,
    issuer: values.JWT_ISSUER,
    audience: values.JWT_AUDIENCE,
    accessTtlMinutes: values.ACCESS_TOKEN_TTL_MIN,
    refreshTtlDays: values.REFRESH_TOKEN_TTL_DAYS,
    otpPepper: values.OTP_PEPPER,
    totpKey
  };
};

export const authSecretsProvider: Provider = {
  provide: TOKENS,
  useFactory: (environment: EnvironmentService): AuthSecrets => authSecretsFrom(environment),
  inject: [EnvironmentService]
};
