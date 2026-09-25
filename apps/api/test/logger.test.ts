import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { loggerOptions } from '../src/logger.js';

describe('logging', () => {
  it('NFR-MA-03: redacts PII and secrets', () => {
    const output: string[] = [];
    const stream = new Writable({ write: (chunk: Buffer | string) => { output.push(chunk.toString()); return true; } });
    const logger = pino({ ...loggerOptions, level: 'info' }, stream);
    logger.info({ phone: '+923001234567', cnic: '35202', password: 'secret', nested: { otp: '123456' } }, 'auth');
    expect(output.join('')).not.toContain('+923001234567');
    expect(output.join('')).not.toContain('35202');
    expect(output.join('')).not.toContain('123456');
  });
});
