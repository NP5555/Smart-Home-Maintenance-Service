import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform(value => value === 'true');
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default('smart-home-api'),
  JWT_AUDIENCE: z.string().min(1).default('smart-home-clients'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_PEPPER: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z.string().min(40),
  CSRF_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),
  PAYMENT_PROVIDER: z.string().default('mock'),
  SMS_PROVIDER: z.string().default('mock'),
  EMAIL_PROVIDER: z.string().default('mock'),
  MAPS_PROVIDER: z.string().default('mock'),
  TELEPHONY_PROVIDER: z.string().default('mock'),
  WHATSAPP_PROVIDER: z.string().default('mock'),
  STORAGE_PROVIDER: z.string().default('mock'),
  MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_REGION: z.string().default('us-east-1'),
  SMTP_URL: z.string().min(1),
  DEV_INBOX_ENABLED: booleanString.default('true')
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.DEV_INBOX_ENABLED) context.addIssue({ code: 'custom', path: ['DEV_INBOX_ENABLED'], message: 'Development inbox must be disabled in production' });
});

export type Environment = z.infer<typeof envSchema>;

@Injectable()
export class EnvironmentService {
  readonly values: Environment;

  constructor(source: NodeJS.ProcessEnv = process.env) {
    const result = envSchema.safeParse(source);
    if (!result.success) throw new Error(`Invalid environment: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    this.values = result.data;
  }

  get corsOrigins(): string[] {
    return this.values.CORS_ORIGINS.split(',').map(value => value.trim()).filter(Boolean);
  }
}
