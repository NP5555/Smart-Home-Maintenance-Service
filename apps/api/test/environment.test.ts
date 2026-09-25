import { describe, expect, it } from 'vitest';
import { EnvironmentValidationError, environmentSchema, parseEnvironment } from '../src/config/environment.schema.js';

const base = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  PORT: '3000',
  API_HOST: '0.0.0.0',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/smart_home',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/smart_home',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ISSUER: 'smart-home-api',
  JWT_AUDIENCE: 'smart-home-clients',
  CSRF_SECRET: 'c'.repeat(32),
  OTP_PEPPER: 'd'.repeat(32),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  MOCK_PAYMENT_WEBHOOK_SECRET: 'e'.repeat(16),
  MINIO_ENDPOINT: 'http://localhost:9000',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'minioadmin',
  SMTP_URL: 'smtp://localhost:1025'
});

describe('strict environment validation', () => {
  it('accepts a complete development environment and applies defaults', () => {
    const values = parseEnvironment(base());
    expect(values.PORT).toBe(3000);
    expect(values.LOG_LEVEL).toBe('info');
    expect(values.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(values.STORAGE_BUCKETS).toEqual(['evidence', 'documents', 'recordings', 'reports']);
    expect(values.DEV_INBOX_ENABLED).toBe(true);
    expect(values.OUTBOX_POLL_INTERVAL_MS).toBe(1_000);
  });

  it('fails fast when a required secret is missing or too short', () => {
    const missing = { ...base() };
    delete missing.DATABASE_URL;
    expect(() => parseEnvironment(missing)).toThrow(EnvironmentValidationError);
    expect(() => parseEnvironment({ ...base(), OTP_PEPPER: 'short' })).toThrow(/OTP_PEPPER/);
  });

  it('reports every problem at once rather than the first one', () => {
    try {
      parseEnvironment({ ...base(), JWT_ACCESS_SECRET: 'short', REDIS_URL: '' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      const issues = (error as EnvironmentValidationError).issues.map(issue => issue.path);
      expect(issues).toContain('JWT_ACCESS_SECRET');
      expect(issues).toContain('REDIS_URL');
    }
  });

  it('rejects a development inbox and development secrets in production', () => {
    const production = { ...base(), NODE_ENV: 'production', JWT_ACCESS_SECRET: 'development-access-secret-change-me-32-chars' };
    const result = environmentSchema.safeParse(production);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(issue => issue.path.join('.'));
      expect(paths).toContain('DEV_INBOX_ENABLED');
      expect(paths).toContain('JWT_ACCESS_SECRET');
    }
  });

  it('keeps every adapter on the mock implementation in this increment', () => {
    const result = environmentSchema.safeParse({ ...base(), PAYMENT_PROVIDER: 'safepay' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['PAYMENT_PROVIDER']);
  });

  it('coerces numeric and boolean strings', () => {
    const values = parseEnvironment({ ...base(), PORT: '4001', DEV_INBOX_ENABLED: 'false', OUTBOX_POLL_INTERVAL_MS: '250' });
    expect(values.PORT).toBe(4001);
    expect(values.DEV_INBOX_ENABLED).toBe(false);
    expect(values.OUTBOX_POLL_INTERVAL_MS).toBe(250);
  });
});
