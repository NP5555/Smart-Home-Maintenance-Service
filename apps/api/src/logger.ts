import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import { REDACTED_PATHS, REDACTION_CENSOR, REQUEST_ID_HEADER } from './common/redaction.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const resolveRequestId = (headers: Pick<IncomingHttpHeaders, 'x-request-id'> | Record<string, unknown>): string => {
  const header = headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) return value;
  return randomUUID();
};

export const buildLoggerOptions = (level: string, isProduction: boolean): FastifyBaseLogger => ({
  level,
  redact: { paths: REDACTED_PATHS, censor: REDACTION_CENSOR, remove: false },
  base: isProduction ? undefined : { service: 'smart-home-api', env: 'development' },
  formatters: {
    level: (label: string) => ({ level: label })
  },
  serializers: {
    err: (error: unknown) => (error instanceof Error ? { type: error.name, message: error.message, stack: error.stack ?? '' } : { type: 'Unknown', message: String(error), stack: '' })
  }
});
