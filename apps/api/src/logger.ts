import { randomUUID } from 'node:crypto';
import { LoggerService, type LogLevel } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
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

/**
 * Keys whose values must never reach a log line. Mirrors REDACTED_PATHS, which
 * the pino configuration used before the move to Express; kept as a flat set
 * because a hand-rolled serialiser matches on the leaf key name rather than a
 * path expression.
 */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'refresh_token',
  'csrftoken',
  'otp',
  'code',
  'phone',
  'phone_e164',
  'phonee164',
  'email',
  'cnic',
  'cnicnumber',
  'address',
  'line1',
  'secret'
]);

const isSensitive = (key: string): boolean => SENSITIVE_KEYS.has(key.toLowerCase());

export const redactValue = (key: string, value: unknown): unknown => {
  if (isSensitive(key)) return REDACTION_CENSOR;
  if (Array.isArray(value)) return value.map(entry => redactValue(key, entry));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = redactValue(childKey, childValue);
  }
  return out;
};

export const serializeError = (error: unknown): { type: string; message: string; stack: string } =>
  error instanceof Error
    ? { type: error.name, message: error.message, stack: error.stack ?? '' }
    : { type: 'Unknown', message: String(error), stack: '' };

export type JsonLoggerLevel = LogLevel | 'silent';

export type JsonLoggerOptions = { level: JsonLoggerLevel; isProduction: boolean };

export const NEST_LOG_LEVELS: readonly LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

/**
 * LOG_LEVEL keeps the pino vocabulary it has always had (`info`, `trace`,
 * `silent`) because it is set in .env files, compose and the deployment docs,
 * so the rename happens here instead of at the environment contract.
 */
const LEVEL_ALIASES: Readonly<Record<string, LogLevel | 'silent'>> = {
  trace: 'verbose',
  info: 'log',
  log: 'log',
  verbose: 'verbose',
  debug: 'debug',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
  silent: 'silent'
};

export const toNestLogLevel = (level: string): LogLevel | 'silent' => LEVEL_ALIASES[level.toLowerCase()] ?? 'log';

/**
 * Emits one JSON object per line on stdout/stderr, matching the shape pino was
 * configured to produce so log shipping and dashboards keep working.
 */
export class JsonLogger implements LoggerService {
  private readonly threshold: number;

  constructor(private readonly options: JsonLoggerOptions) {
    const resolved = LEVEL_ALIASES[options.level.toLowerCase()] ?? 'log';
    const index = NEST_LOG_LEVELS.indexOf(resolved as LogLevel);
    this.threshold = resolved === 'silent' ? Number.POSITIVE_INFINITY : index === -1 ? NEST_LOG_LEVELS.indexOf('log') : index;
  }

  private write(level: LogLevel, message: unknown, context?: string, extra?: Record<string, unknown>): void {
    if (NEST_LOG_LEVELS.indexOf(level) < this.threshold) return;
    const record: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      ...(this.options.isProduction ? {} : { service: 'smart-home-api', env: 'development' }),
      ...(context === undefined ? {} : { context }),
      msg: typeof message === 'string' ? message : serializeError(message).message
    };
    for (const [key, value] of Object.entries(extra ?? {})) {
      record[key === 'err' ? 'err' : key] = key === 'err' ? serializeError(value) : redactValue(key, value);
    }
    const line = `${JSON.stringify(record)}\n`;
    if (level === 'error' || level === 'fatal') process.stderr.write(line);
    else process.stdout.write(line);
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace === undefined ? {} : { trace });
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }
}

/** Exposed so the redaction list stays provably in step with the pino one. */
export const REDACTED_FIELD_NAMES: readonly string[] = REDACTED_PATHS.flatMap(path => path.split('.').pop() ?? []).filter(name => name !== '*');
