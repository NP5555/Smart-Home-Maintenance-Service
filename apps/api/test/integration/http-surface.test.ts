import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'light-my-request';
import type { OutgoingHttpHeaders } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from './harness.js';
import { BODY_LIMIT, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, createRateLimitMiddleware } from '../../src/http-app.js';

let app: NestExpressApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
});

/**
 * These routes are excluded from the global prefix and are not described in the
 * OpenAPI document, so `api-surface.baseline.json` cannot prove they survived
 * the move to Express. They are asserted here instead.
 */
describe('routes the OpenAPI document does not describe', () => {
  it('serves the root welcome message at the unprefixed path', async () => {
    const response = await callRaw('GET', '/');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ service: 'smart-home-maintenance-service', api: 'api/v1', docs: '/api/docs' });
  });

  it('serves liveness and readiness without the api/v1 prefix', async () => {
    const live = await callRaw('GET', '/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: 'ok' });

    const ready = await callRaw<{ status: string; checks: { name: string }[] }>('GET', '/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks.map(check => check.name)).toEqual(['database', 'redis', 'queues', 'settings', 'storage']);
  });

  it('serves the Swagger UI and its JSON document', async () => {
    const ui = await callRaw('GET', '/api/docs');
    expect(ui.status).toBe(200);
    expect(String(ui.text)).toContain('<html');

    const json = await callRaw<{ openapi: string; paths: Record<string, unknown> }>('GET', '/api/docs/openapi.json');
    expect(json.status).toBe(200);
    expect(json.body.openapi).toMatch(/^3\./);
    expect(Object.keys(json.body.paths).length).toBeGreaterThan(20);
  });

  it('does not serve a prefixed copy of the health routes', async () => {
    expect((await callRaw('GET', '/api/v1/health/live')).status).toBe(404);
  });
});

describe('response headers', () => {
  it('echoes a supplied request id and mints one otherwise', async () => {
    const supplied = await callRaw('GET', '/health/live', { 'x-request-id': 'trace-abc-123' });
    expect(headerOf(supplied, 'x-request-id')).toBe('trace-abc-123');

    const minted = await callRaw('GET', '/health/live');
    expect(headerOf(minted, 'x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('publishes the rate limit budget on every response', async () => {
    const response = await callRaw('GET', '/health/live');
    expect(headerOf(response, 'x-ratelimit-limit')).toBe(String(RATE_LIMIT_MAX));
    expect(Number(headerOf(response, 'x-ratelimit-remaining'))).toBeLessThanOrEqual(RATE_LIMIT_MAX);
  });

  it('sets the helmet headers', async () => {
    const response = await callRaw('GET', '/health/live');
    expect(headerOf(response, 'x-content-type-options')).toBe('nosniff');
    expect(headerOf(response, 'x-dns-prefetch-control')).toBeDefined();
  });

  it('answers a CORS preflight for an allowed origin', async () => {
    const response = await callRaw('OPTIONS', '/api/v1/auth/login', {
      origin: 'http://localhost:3000',
      'access-control-request-method': 'POST'
    });
    expect([200, 204]).toContain(response.status);
    expect(headerOf(response, 'access-control-allow-origin')).toBe('http://localhost:3000');
    expect(headerOf(response, 'access-control-allow-credentials')).toBe('true');
  });
});

describe('NFR-SC-04: the 1 MiB body limit still applies', () => {
  const padding = (bytes: number): string => `{"target":"+923001234567","purpose":"LOGIN","pad":"${'x'.repeat(bytes)}"}`;

  it('accepts a body just under the limit', async () => {
    const response = await callRaw('POST', '/api/v1/auth/otp/request', { 'content-type': 'application/json' }, padding(900_000));
    expect(response.status).not.toBe(413);
  });

  it('rejects a body over the limit with 413', async () => {
    const response = await callRaw<{ code: string; status: number; title: string }>('POST', '/api/v1/auth/otp/request', { 'content-type': 'application/json' }, padding(1_200_000));
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413, title: 'Payload Too Large' });
  });

  it('rejects a malformed JSON body with 400 rather than a 500', async () => {
    const response = await callRaw<{ code: string; status: number }>('POST', '/api/v1/auth/otp/request', { 'content-type': 'application/json' }, '{"target": ');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'BAD_REQUEST', status: 400 });
  });

  it('documents the limit it enforces', () => {
    expect(BODY_LIMIT).toBe('1mb');
  });
});

describe('rate limiting', () => {
  type Fake = { statuses: number[]; nexted: number; headers: Record<string, unknown> };

  const fakeResponse = (fake: Fake): Record<string, unknown> => {
    const response = {
      status(code: number) {
        fake.statuses.push(code);
        return response;
      },
      type() {
        return response;
      },
      send() {
        return response;
      },
      setHeader(name: string, value: unknown) {
        fake.headers[name] = value;
        return response;
      }
    };
    return response;
  };

  it('allows the configured budget per window and then answers 429', () => {
    const middleware = createRateLimitMiddleware(3, 60_000);
    const fake: Fake = { statuses: [], nexted: 0, headers: {} };
    const run = (): void => {
      middleware({ ip: '10.0.0.1', url: '/api/v1/catalogue/categories' } as never, fakeResponse(fake) as never, () => {
        fake.nexted += 1;
      });
    };
    run();
    run();
    run();
    expect(fake.statuses).toEqual([]);
    expect(fake.nexted).toBe(3);
    run();
    expect(fake.statuses).toEqual([429]);
    expect(fake.nexted).toBe(3);
    expect(fake.headers['Retry-After']).toBeGreaterThan(0);
  });

  it('gives each client its own window', () => {
    const middleware = createRateLimitMiddleware(1, 60_000);
    const fake: Fake = { statuses: [], nexted: 0, headers: {} };
    const call = (ip: string): void => {
      middleware({ ip, url: '/api/v1/catalogue/categories' } as never, fakeResponse(fake) as never, () => {
        fake.nexted += 1;
      });
    };
    call('10.0.0.1');
    call('10.0.0.1');
    expect(fake.statuses).toEqual([429]);
    expect(fake.nexted).toBe(1);
    call('10.0.0.2');
    expect(fake.nexted).toBe(2);
  });

  it('uses the 300 per minute budget Fastify was configured with', () => {
    expect(RATE_LIMIT_MAX).toBe(300);
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });
});

type RawResponse<T = Record<string, unknown>> = {
  status: number;
  body: T;
  text: string;
  headers: OutgoingHttpHeaders;
};

/** Dispatches without the harness prefix helper so the unprefixed routes can be reached. */
const callRaw = async <T = Record<string, unknown>>(method: string, path: string, headers: Record<string, string> = {}, payload?: string): Promise<RawResponse<T>> => {
  const response = await inject(app.getHttpAdapter().getInstance(), {
    method: method as 'GET' | 'POST' | 'OPTIONS',
    url: path,
    headers,
    ...(payload === undefined ? {} : { payload })
  });
  let parsed: unknown;
  try {
    parsed = response.payload === '' ? null : JSON.parse(response.payload);
  } catch {
    parsed = response.payload;
  }
  return { status: response.statusCode, body: parsed as T, text: response.payload, headers: response.headers };
};

const headerOf = (response: RawResponse, name: string): string | undefined => {
  const value = response.headers[name];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : String(value);
};
