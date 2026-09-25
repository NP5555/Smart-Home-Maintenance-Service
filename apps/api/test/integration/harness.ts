import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module.js';
import { EnvironmentService } from '../../src/config/environment.service.js';
import { configureHttpApp, registerHttpPlugins } from '../../src/http-app.js';
import { totpCode } from '../../src/identity/otp.js';
import { decryptTotpSecret } from '../../src/identity/totp-vault.js';
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

export const patchJson = (payload: unknown, token?: string): RequestInit => ({
  method: 'PATCH',
  body: JSON.stringify(payload),
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
});

export const putJson = (payload: unknown, token?: string): RequestInit => ({
  method: 'PUT',
  body: JSON.stringify(payload),
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
});

export const deleteWith = (token?: string): RequestInit => ({
  method: 'DELETE',
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

export const SEEDED_ADMIN = { identifier: 'admin@smart-home.local', password: 'DevPassword!2026' };

/**
 * A provider fully set up and approved to offer leak-repair, with a weekly
 * availability block covering the requested window and no service-area
 * restriction that would block a test. Centred on BASE_LAT/BASE_LNG (Lahore)
 * so distance-based logic elsewhere in the suite keeps working the same way.
 */
export const readyBookableProvider = async (
  app: NestFastifyApplication
): Promise<{ provider: TestUser; serviceId: number; areaId: number; minPricePaisa: number }> => {
  const admin = await adminSession(app);
  const service = await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair');
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
  const areaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;

  const provider = await registerAndVerify(app, 'PROVIDER');
  const asProvider = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${provider.accessToken}` } });
  await callApi(app, '/provider/profile', asProvider(patchJson({ cityId: lahore.id, lat: 31.5204, lng: 74.3587, radiusM: 10_000 })));
  // Every weekday, 00:00-23:59, so any test-chosen slot lands inside it without the suite needing to know today's weekday.
  await callApi(
    app,
    '/provider/availability',
    asProvider(putJson({ items: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: '00:00', endTime: '23:59' })) }))
  );
  await callApi(app, '/provider/service-areas', asProvider(putJson({ areaIds: [areaId] })));
  await callApi(app, `/provider/services/${service.body.id}`, putJson({ pricePaisa: service.body.minPricePaisa }, provider.accessToken));
  const adminAuth = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` } });
  await callApi(app, `/admin/provider-services/${provider.id}/${service.body.id}/approve`, adminAuth({ method: 'POST' }));
  await callApi(app, `/admin/providers/${provider.id}/approve`, adminAuth({ method: 'POST' }));

  return { provider, serviceId: service.body.id, areaId, minPricePaisa: service.body.minPricePaisa };
};

let testPrisma: PrismaClient | undefined;
const prismaForTests = (): PrismaClient => (testPrisma ??= new PrismaClient());

/**
 * Signs in as the seeded admin with a valid TOTP code. The seeded admin is
 * shared, mutable state across the whole integration suite: the first run
 * against a fresh database enrols TOTP itself, and every later run (this
 * suite or an earlier one) reads the already-enrolled secret back out of the
 * database — decrypted with the same key the API uses — because there is no
 * way to recover a secret that a previous run already consumed.
 */
export const adminSession = async (app: NestFastifyApplication): Promise<{ accessToken: string; userId: string }> => {
  const bare = await loginAs(app, SEEDED_ADMIN.identifier, SEEDED_ADMIN.password);
  if (bare.status === 201 && bare.body.totpRequired && !bare.body.user.totpEnabled) {
    const setup = await callApi<{ secret: string }>(app, '/auth/totp/setup', { method: 'POST', headers: { authorization: `Bearer ${bare.body.accessToken}` } });
    const code = totpCode(setup.body.secret, new Date());
    await callApi(app, '/auth/totp/verify', postJson({ code }, bare.body.accessToken));
    const signedIn = await loginAs(app, SEEDED_ADMIN.identifier, SEEDED_ADMIN.password, code);
    if (signedIn.status !== 201) throw new Error(`admin totp login failed after enrolment: ${signedIn.status} ${JSON.stringify(signedIn.body)}`);
    return { accessToken: signedIn.body.accessToken, userId: signedIn.body.user.id };
  }
  const rows = await prismaForTests().$queryRaw<{ secret: Buffer }[]>`SELECT totp_secret_enc as secret FROM users WHERE email = ${SEEDED_ADMIN.identifier}`;
  const encrypted = rows[0]?.secret;
  if (encrypted === undefined) throw new Error('Seeded admin has no TOTP secret to decrypt');
  const secret = decryptTotpSecret(Buffer.from(process.env.TOTP_ENCRYPTION_KEY ?? '', 'base64'), encrypted);
  const code = totpCode(secret, new Date());
  const signedIn = await loginAs(app, SEEDED_ADMIN.identifier, SEEDED_ADMIN.password, code);
  if (signedIn.status !== 201) throw new Error(`admin totp login failed: ${signedIn.status} ${JSON.stringify(signedIn.body)}`);
  return { accessToken: signedIn.body.accessToken, userId: signedIn.body.user.id };
};
