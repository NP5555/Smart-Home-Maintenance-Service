import { describe, expect, it } from 'vitest';
import { buildLoggerOptions, resolveRequestId } from '../src/logger.js';
import { REDACTED_PATHS } from '../src/common/redaction.js';

describe('Pino request id and PII redaction', () => {
  it('reuses a well formed inbound request id and mints one otherwise', () => {
    expect(resolveRequestId({ headers: { 'x-request-id': 'trace-abc-123' } } as never)).toBe('trace-abc-123');
    expect(resolveRequestId({ headers: {} } as never)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId({ headers: { 'x-request-id': 'a'.repeat(200) } } as never)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('NFR-MA-03: redacts phone, email, cnic, otp, password, tokens and addresses', () => {
    const paths = REDACTED_PATHS.join(' ');
    for (const field of ['password', 'otp', 'cnic', 'phone', 'email', 'token', 'address', 'authorization', 'cookie']) {
      expect(paths).toContain(field);
    }
  });

  it('produces logger options with a censor marker and a level', () => {
    const options = buildLoggerOptions('info', true);
    expect(options.level).toBe('info');
    expect(typeof options.redact === 'object' && options.redact !== null && 'censor' in options.redact ? options.redact.censor : undefined).toBe('[REDACTED]');
    expect(options.base).toEqual({});
    expect(buildLoggerOptions('debug', false).base).toEqual({ service: 'smart-home-api', env: 'development' });
  });
});
