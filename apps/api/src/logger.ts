import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { LoggerOptions } from 'pino';
import { REDACTED_PATHS, REDACTION_CENSOR, REQUEST_ID_HEADER } from './common/redaction.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const headerValue = (source: Record<string, unknown>, header: string): string | undefined => {
  const lower = header.toLowerCase();
  const bags = [source, (source.headers as Record<string, unknown> | undefined) ?? undefined];
  for (const bag of bags) {
    if (!bag) continue;
    for (const [key, value] of Object.entries(bag)) {
      if (key.toLowerCase() !== lower) continue;
      const single = Array.isArray(value) ? value[0] : value;
      if (typeof single === 'string') return single;
    }
  }
  return undefined;
};

export const resolveRequestId = (headers: Pick<IncomingHttpHeaders, 'x-request-id'> | Record<string, unknown>): string => {
  const value = headerValue(headers, REQUEST_ID_HEADER);
  if (value !== undefined && REQUEST_ID_PATTERN.test(value)) return value;
  return randomUUID();
};

export const buildLoggerOptions = (level: string, isProduction: boolean): LoggerOptions => ({
  level,
  redact: { paths: REDACTED_PATHS, censor: REDACTION_CENSOR, remove: false },
  base: isProduction ? {} : { service: 'smart-home-api', env: 'development' },
  formatters: {
    level: label => ({ level: label })
  },
  serializers: {
    err: (error: unknown) => (error instanceof Error ? { type: error.name, message: error.message, stack: error.stack ?? '' } : { type: 'Unknown', message: String(error), stack: '' })
  }
});
