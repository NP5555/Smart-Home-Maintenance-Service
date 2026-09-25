import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module.js';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { configureHttpApp, registerHttpPlugins } from '../../src/http-app.js';
import { SettingsService } from '../../src/platform/settings.service.js';

export type TestUser = { id: string; phoneE164: string; email: string | null; accessToken: string; refreshCookie: string | undefined };

export type ApiResponse<T = unknown> = { status: number; body: T; setCookie: string[] };

/**
 * Boots the real application graph against the running PostGIS and Redis so the
 * identity suite exercises routing, the policy guard, the idempotency
 * interceptor and the database together rather than mocking any of them.
 */
export const createTestApp = async (): Promise<{ app: NestFastifyApplication; close: () => Promise<void> }> => {
  const environment = new EnvironmentService();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false, trustProxy: true }), { logger: false });
  await registerHttpPlugins(app, environment);
  configureHttpApp(app, environment);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await app.get(SettingsService).start();
  return {
    app,
    close: async () => {
      await app.get(SettingsService).stop();
      await app.close();
    }
  };
};

export const uniquePhone = (): string => `+9231${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

export const newStaffSession = (): string => randomUUID();

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type InjectLike = { statusCode: number; body: string; cookies: { name: string; value: string; path?: string }[] };

export const callApi = async <T = unknown>(app: NestFastifyApplication, path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const server = app.getHttpAdapter().getInstance();
  const hasBody = init.body !== undefined;
  const options = {
    method: (init.method ?? 'GET') as HttpMethod,
    url: path.startsWith('/api/v1') ? path : `/api/v1${path}`,
    // Only advertise JSON when there is a body: Fastify rejects a request that
    // claims application/json and then sends nothing.
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) },
    ...(hasBody ? { payload: init.body as string } : {})
  };
  const response = (await server.inject(options)) as unknown as InjectLike;
  let body: unknown;
  try {
    body = response.body === '' ? null : JSON.parse(response.body);
  } catch {
    body = response.body;
  }
  return { status: response.statusCode, body: body as T, setCookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}; Path=${cookie.path ?? '/'}`) };
};

export const postJson = (payload: unknown, token?: string): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(payload),
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
});

/** Reads the most recent code the mock SMS adapter captured for a target. */
export const readOtpFromInbox = async (app: NestFastifyApplication, target: string): Promise<string> => {
  const response = await callApi<{ items: { recipient: string; body: string; metadata?: Record<string, string> }[] }>(app, '/dev/inbox?limit=50');
  const message = response.body.items.find(item => item.recipient === target);
  if (message === undefined) throw new Error(`No inbox message was delivered to ${target}`);
  const match = /\b(\d{6})\b/.exec(message.body);
  if (match === null) throw new Error(`The inbox message for ${target} carries no six digit code`);
  return match[1] as string;
};

export const refreshCookieOf = (response: ApiResponse): string | undefined => {
  const cookie = response.setCookie.find(entry => entry.startsWith('shm_rt='));
  return cookie?.split(';')[0];
};

export const registerAndVerify = async (app: NestFastifyApplication, role: 'CUSTOMER' | 'PROVIDER', phone = uniquePhone()): Promise<TestUser> => {
  const password = 'CorrectHorse9Battery';
  const registered = await callApi<{ userId: string }>(app, '/auth/register', postJson({ role, phoneE164: phone, password, firstName: 'Test', lastName: 'User' }));
  if (registered.status !== 201) throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
  const code = await readOtpFromInbox(app, phone);
  const verified = await callApi<{ user: { id: string; roles: string[] }; accessToken: string }>(app, '/auth/otp/verify', postJson({ target: phone, purpose: 'REGISTER', code }));
  if (verified.status !== 201) throw new Error(`otp verify failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  return { id: registered.body.userId, phoneE164: phone, email: null, accessToken: verified.body.accessToken, refreshCookie: refreshCookieOf(verified) };
};

export const loginAs = async (app: NestFastifyApplication, identifier: string, password: string, totpCode?: string): Promise<ApiResponse<{ accessToken: string; user: { id: string; roles: string[]; totpEnabled: boolean }; totpRequired: boolean }>> =>
  callApi(app, '/auth/login', postJson(totpCode === undefined ? { identifier, password } : { identifier, password, totpCode }));
