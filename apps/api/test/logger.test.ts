import { describe, expect, it } from 'vitest';
import { JsonLogger, NEST_LOG_LEVELS, redactValue, resolveRequestId, serializeError, toNestLogLevel } from '../src/logger.js';
import { REDACTED_PATHS } from '../src/common/redaction.js';

describe('request id resolution', () => {
  it('reuses a well formed inbound request id and mints one otherwise', () => {
    expect(resolveRequestId({ headers: { 'x-request-id': 'trace-abc-123' } })).toBe('trace-abc-123');
    expect(resolveRequestId({ 'x-request-id': 'trace-abc-123' })).toBe('trace-abc-123');
    expect(resolveRequestId({ 'X-Request-Id': 'trace-abc-123' })).toBe('trace-abc-123');
    expect(resolveRequestId({ headers: { 'x-request-id': ['trace-abc-123'] } })).toBe('trace-abc-123');
    expect(resolveRequestId({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId({ headers: { 'x-request-id': 'a'.repeat(200) } })).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId({ headers: { 'x-request-id': 'has spaces' } })).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId({ headers: { 'x-request-id': 42 } })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('LOG_LEVEL compatibility', () => {
  it('keeps the pino vocabulary that .env and compose already set', () => {
    expect(toNestLogLevel('info')).toBe('log');
    expect(toNestLogLevel('trace')).toBe('verbose');
    expect(toNestLogLevel('silent')).toBe('silent');
    expect(toNestLogLevel('error')).toBe('error');
    expect(toNestLogLevel('nonsense')).toBe('log');
  });

  it('mutes every level when LOG_LEVEL is silent', () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string): boolean => {
      written.push(String(chunk));
      return true;
    };
    try {
      const logger = new JsonLogger({ level: 'silent', isProduction: true });
      logger.log('a');
      logger.warn('b');
      logger.error('c');
    } finally {
      process.stdout.write = original;
    }
    expect(written).toEqual([]);
  });
});

describe('NFR-MA-03: PII redaction', () => {
  it('redacts phone, email, cnic, otp, password, tokens and addresses', () => {
    const paths = REDACTED_PATHS.join(' ');
    for (const field of ['password', 'otp', 'cnic', 'phone', 'email', 'token', 'address', 'authorization', 'cookie']) {
      expect(paths).toContain(field);
    }
  });

  it('replaces sensitive values at any depth, case insensitively', () => {
    expect(redactValue('phoneE164', '+923001234567')).toBe('[REDACTED]');
    expect(redactValue('Password', 'hunter2')).toBe('[REDACTED]');
    expect(redactValue('user', { email: 'a@b.com', id: 'u1' })).toEqual({ email: '[REDACTED]', id: 'u1' });
    expect(redactValue('items', [{ cnic: '35202-1', ok: true }])).toEqual([{ cnic: '[REDACTED]', ok: true }]);
  });

  it('leaves non-sensitive values untouched', () => {
    expect(redactValue('status', 'APPROVED')).toBe('APPROVED');
    expect(redactValue('count', 42)).toBe(42);
    expect(redactValue('at', null)).toBeNull();
  });
});

describe('JsonLogger', () => {
  const captureStdout = (run: () => void): string[] => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string): boolean => {
      written.push(String(chunk));
      return true;
    };
    try {
      run();
    } finally {
      process.stdout.write = original;
    }
    return written;
  };

  const parseLine = (lines: string[], index: number): Record<string, unknown> => {
    const line = lines[index];
    if (line === undefined) throw new Error(`no log line was written at index ${index}`);
    return JSON.parse(line) as Record<string, unknown>;
  };

  it('emits one JSON object per line and keeps production free of local context', () => {
    const written = captureStdout(() => {
      new JsonLogger({ level: 'log', isProduction: true }).log('listening', 'Bootstrap');
      new JsonLogger({ level: 'log', isProduction: false }).log('listening', 'Bootstrap');
    });
    expect(written).toHaveLength(2);
    const production = parseLine(written, 0);
    expect(production.level).toBe('log');
    expect(production.msg).toBe('listening');
    expect(production.context).toBe('Bootstrap');
    expect(production).not.toHaveProperty('env');
    expect(production.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parseLine(written, 1)).toMatchObject({ service: 'smart-home-api', env: 'development' });
  });

  it('drops records below the configured level', () => {
    const written = captureStdout(() => {
      const logger = new JsonLogger({ level: 'warn', isProduction: true });
      logger.log('ignored');
      logger.debug('ignored');
      logger.warn('kept');
    });
    expect(written).toHaveLength(1);
    expect(parseLine(written, 0)).toMatchObject({ level: 'warn', msg: 'kept' });
  });

  it('exposes the Nest level order used for thresholding', () => {
    expect(NEST_LOG_LEVELS).toContain('log');
  });
});

describe('error serialisation', () => {
  it('keeps the type, message and stack pino used to report', () => {
    const error = new TypeError('boom');
    expect(serializeError(error)).toEqual({ type: 'TypeError', message: 'boom', stack: error.stack });
    expect(serializeError('plain')).toEqual({ type: 'Unknown', message: 'plain', stack: '' });
  });
});
