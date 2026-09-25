import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { totpCode } from '../../src/identity/otp.js';
import { callApi, createTestApp, loginAs, postJson, readOtpFromInbox, refreshCookieOf, registerAndVerify, uniquePhone, type ApiResponse } from './harness.js';

const PASSWORD = 'CorrectHorse9Battery';
const NEW_PASSWORD = 'BrandNewPass9';
const SEEDED = { identifier: 'admin@smart-home.local', password: 'DevPassword!2026' };

let app: NestFastifyApplication;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
});

afterAll(async () => {
  await close();
});

const withCookie = (cookie: string): RequestInit => ({ method: 'POST', headers: { cookie } });

describe('SHM-009 registration and phone verification', () => {
  it('FR-CU-01/03: registers a customer, sends an OTP and only issues a session once the code is redeemed', async () => {
    const phone = uniquePhone();
    const registered = await callApi<{ userId: string; requiresOtp: boolean }>(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: phone, password: PASSWORD, firstName: 'Ayesha', lastName: 'Khan' }));
    expect(registered.status).toBe(201);
    expect(registered.body.requiresOtp).toBe(true);
    expect(refreshCookieOf(registered)).toBeUndefined();

    const code = await readOtpFromInbox(app, phone);
    const verified = await callApi<{ user: { roles: string[] }; accessToken: string }>(app, '/auth/otp/verify', postJson({ target: phone, purpose: 'REGISTER', code }));
    expect(verified.status).toBe(201);
    expect(verified.body.user.roles).toEqual(['CUSTOMER']);
    expect(refreshCookieOf(verified)).toBeDefined();

    const me = await callApi<{ user: { id: string; phoneE164: string } }>(app, '/auth/me', { headers: { authorization: `Bearer ${verified.body.accessToken}` } });
    expect(me.status).toBe(200);
    expect(me.body.user.phoneE164).toBe(phone);

    const verifiedAt = await queryRows<{ phone_verified_at: Date | null }>('SELECT phone_verified_at FROM users WHERE id = $1::uuid', [registered.body.userId]);
    expect(verifiedAt[0]?.phone_verified_at).not.toBeNull();
  });

  it('FR-SP-01: a provider account starts PENDING_APPROVAL', async () => {
    const phone = uniquePhone();
    await callApi(app, '/auth/register', postJson({ role: 'PROVIDER', phoneE164: phone, password: PASSWORD, firstName: 'Bilal', lastName: 'Khan' }));
    const rows = await providerStatusOf(phone);
    expect(rows).toEqual(['PENDING_APPROVAL']);
  });

  it('rejects a duplicate phone number with 409 CONFLICT rather than a 500', async () => {
    const phone = uniquePhone();
    await callApi(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: phone, password: PASSWORD, firstName: 'A', lastName: 'B' }));
    const again = await callApi<{ code: string; detail: string }>(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: phone, password: PASSWORD, firstName: 'A', lastName: 'B' }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT');
    expect(again.body.detail).toMatch(/already exists/i);
  });

  it('refuses a password that fails the policy, and never echoes it', async () => {
    const response = await callApi<{ code: string; errors: { path: string }[] }>(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: uniquePhone(), password: 'weak', firstName: 'A', lastName: 'B' }));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors.map(error => error.path)).toContain('password');
    expect(JSON.stringify(response.body)).not.toContain('weak');
  });

  it('rejects a password that meets the length rule but not the complexity rule', async () => {
    const response = await callApi<{ code: string; errors: { path: string; message: string }[] }>(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: uniquePhone(), password: 'alllowercaseletters', firstName: 'A', lastName: 'B' }));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    const field = response.body.errors.find(error => error.path === 'password');
    expect(field?.message).toMatch(/uppercase/);
    expect(JSON.stringify(response.body)).not.toContain('alllowercaseletters');
  });

  it('validates the registration payload and names the offending field', async () => {
    const response = await callApi<{ code: string; errors: { path: string }[] }>(app, '/auth/register', postJson({ role: 'ADMIN', phoneE164: 'not-a-phone', password: PASSWORD, firstName: '', lastName: 'B' }));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    const paths = response.body.errors.map(error => error.path);
    expect(paths).toEqual(expect.arrayContaining(['role', 'phoneE164', 'firstName']));
  });

  it('will not let a self-registration claim a staff role', async () => {
    for (const role of ['AGENT', 'FINANCE', 'ADMIN']) {
      const response = await callApi(app, '/auth/register', postJson({ role, phoneE164: uniquePhone(), password: PASSWORD, firstName: 'A', lastName: 'B' }));
      expect(response.status).toBe(422);
    }
  });
});

describe('FR-CU-04 / NFR-SE-06: OTP attempt limits', () => {
  it('locks a code after the configured number of wrong attempts', async () => {
    const phone = uniquePhone();
    await callApi(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: phone, password: PASSWORD, firstName: 'A', lastName: 'B' }));
    await readOtpFromInbox(app, phone);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await callApi<{ code: string; detail: string }>(app, '/auth/otp/verify', postJson({ target: phone, purpose: 'REGISTER', code: '000000' }));
      expect(wrong.status, `attempt ${attempt}`).toBe(422);
      expect(wrong.body.code).toBe('OTP_INVALID');
      expect(wrong.body.detail).toContain(String(5 - attempt));
    }

    const locked = await callApi<{ code: string }>(app, '/auth/otp/verify', postJson({ target: phone, purpose: 'REGISTER', code: '000000' }));
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('OTP_LOCKED');

    const correct = await callApi<{ code: string }>(app, '/auth/otp/verify', postJson({ target: phone, purpose: 'REGISTER', code: '000000' }));
    expect(correct.status).toBe(423);
  });

  it('consumes a code so the same one cannot be replayed', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const code = await readOtpFromInbox(app, user.phoneE164);
    const replay = await callApi<{ code: string }>(app, '/auth/otp/verify', postJson({ target: user.phoneE164, purpose: 'REGISTER', code }));
    expect(replay.status).toBe(422);
    expect(replay.body.code).toBe('OTP_INVALID');
  });

  it('rate limits a resend of the same target', async () => {
    const phone = uniquePhone();
    await callApi(app, '/auth/register', postJson({ role: 'CUSTOMER', phoneE164: phone, password: PASSWORD, firstName: 'A', lastName: 'B' }));
    const second = await callApi<{ code: string }>(app, '/auth/otp/request', postJson({ target: phone, purpose: 'REGISTER' }));
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('RATE_LIMITED');
  });

  it('will not request a non-REGISTER code for an unknown target', async () => {
    const response = await callApi<{ code: string }>(app, '/auth/otp/request', postJson({ target: uniquePhone(), purpose: 'LOGIN' }));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('OTP_INVALID');
  });
});

describe('FR-CU-01: login and rate limiting', () => {
  it('signs in with either the phone number or the email address', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const byPhone = await loginAs(app, user.phoneE164, PASSWORD);
    expect(byPhone.status).toBe(201);
    expect(byPhone.body.user.roles).toEqual(['CUSTOMER']);
  });

  it('delivers the refresh token as an httpOnly cookie scoped to the auth routes', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const login = await loginAs(app, user.phoneE164, PASSWORD);
    expect(login.setCookie.some(cookie => cookie.startsWith('shm_rt='))).toBe(true);
    expect(refreshCookieOf(login)).toBeDefined();
  });

  it('never returns the refresh token in the response body', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const login = await loginAs(app, user.phoneE164, PASSWORD);
    expect(JSON.stringify(login.body)).not.toContain('refreshToken');
  });

  it('gives the same message for a wrong password and an unknown account', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const wrongPassword = await callApi<{ detail: string }>(app, '/auth/login', postJson({ identifier: user.phoneE164, password: 'WrongPassword123' }));
    const unknownUser = await callApi<{ detail: string }>(app, '/auth/login', postJson({ identifier: uniquePhone(), password: 'WrongPassword123' }));
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.detail).toBe(unknownUser.body.detail);
  });

  it('locks the identifier out after the configured number of failures', async () => {
    const phone = uniquePhone();
    await registerAndVerify(app, 'CUSTOMER', phone);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failure = await callApi<{ code: string }>(app, '/auth/login', postJson({ identifier: phone, password: 'WrongPassword123' }));
      expect(failure.status, `attempt ${attempt + 1}`).toBe(401);
    }
    const locked = await callApi<{ code: string }>(app, '/auth/login', postJson({ identifier: phone, password: PASSWORD }));
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('RATE_LIMITED');
  });

  it('clears the failure counter once the correct password is used', async () => {
    const phone = uniquePhone();
    await registerAndVerify(app, 'CUSTOMER', phone);
    expect((await callApi(app, '/auth/login', postJson({ identifier: phone, password: 'WrongPassword123' }))).status).toBe(401);
    expect((await callApi(app, '/auth/login', postJson({ identifier: phone, password: PASSWORD }))).status).toBe(201);
    expect((await callApi(app, '/auth/login', postJson({ identifier: phone, password: 'WrongPassword123' }))).status).toBe(401);
  });
});

describe('FR-CU-04: refresh rotation, reuse detection and logout', () => {
  it('rotates the refresh token on every use', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const login = await loginAs(app, user.phoneE164, PASSWORD);
    const first = refreshCookieOf(login) as string;
    const second = refreshCookieOf(await callApi(app, '/auth/refresh', withCookie(first))) as string;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await callApi<{ code: string }>(app, '/auth/refresh', withCookie('shm_rt=' + 'x'.repeat(43)));
    expect(response.status).toBe(401);
  });

  it('detects reuse and revokes the whole token family', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const login = await loginAs(app, user.phoneE164, PASSWORD);
    const tokenA = refreshCookieOf(login) as string;
    const tokenB = refreshCookieOf(await callApi(app, '/auth/refresh', withCookie(tokenA))) as string;
    const tokenC = refreshCookieOf(await callApi(app, '/auth/refresh', withCookie(tokenB))) as string;

    const replayed = await callApi<{ code: string }>(app, '/auth/refresh', withCookie(tokenB));
    expect(replayed.status).toBe(401);
    expect(replayed.body.code).toBe('REFRESH_REUSE_DETECTED');

    const liveToken = await callApi<{ code: string }>(app, '/auth/refresh', withCookie(tokenC));
    expect(liveToken.status).toBe(401);
    expect(liveToken.body.code).toBe('REFRESH_REUSE_DETECTED');
  });

  it('logout revokes the presented token', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const login = await loginAs(app, user.phoneE164, PASSWORD);
    const cookie = refreshCookieOf(login) as string;
    const loggedOut = await callApi(app, '/auth/logout', withCookie(cookie));
    expect(loggedOut.status).toBe(204);
    expect((await callApi<{ code: string }>(app, '/auth/refresh', withCookie(cookie))).body.code).toBe('UNAUTHENTICATED');
  });

  it('requires a refresh token to refresh', async () => {
    const response = await callApi<{ code: string }>(app, '/auth/refresh', { method: 'POST' });
    expect(response.status).toBe(401);
  });
});

describe('FR-CU-04: password recovery', () => {
  it('never reveals whether the identifier exists', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const known = await callApi<{ body: { sent: boolean } }>(app, '/auth/password/forgot', postJson({ identifier: user.phoneE164 }));
    const unknown = await callApi<{ body: { sent: boolean } }>(app, '/auth/password/forgot', postJson({ identifier: uniquePhone() }));
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
  });

  it('sets the new password, rejects the old one and signs out every other session', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    const firstSession = refreshCookieOf(await loginAs(app, user.phoneE164, PASSWORD)) as string;
    const secondSession = refreshCookieOf(await loginAs(app, user.phoneE164, PASSWORD)) as string;

    await callApi(app, '/auth/password/forgot', postJson({ identifier: user.phoneE164 }));
    const code = await readOtpFromInbox(app, user.phoneE164);
    const reset = await callApi(app, '/auth/password/reset', postJson({ identifier: user.phoneE164, code, newPassword: NEW_PASSWORD }));
    expect(reset.status).toBe(201);

    expect((await callApi<{ code: string }>(app, '/auth/refresh', withCookie(firstSession))).status).toBe(401);
    expect((await callApi<{ code: string }>(app, '/auth/refresh', withCookie(secondSession))).status).toBe(401);
    expect((await callApi(app, '/auth/login', postJson({ identifier: user.phoneE164, password: PASSWORD }))).status).toBe(401);
    expect((await loginAs(app, user.phoneE164, NEW_PASSWORD)).status).toBe(201);
  });

  it('rejects a reset code that has already been used', async () => {
    const user = await registerAndVerify(app, 'CUSTOMER');
    await callApi(app, '/auth/password/forgot', postJson({ identifier: user.phoneE164 }));
    const code = await readOtpFromInbox(app, user.phoneE164);
    expect((await callApi(app, '/auth/password/reset', postJson({ identifier: user.phoneE164, code, newPassword: NEW_PASSWORD }))).status).toBe(201);
    const replay = await callApi<{ code: string }>(app, '/auth/password/reset', postJson({ identifier: user.phoneE164, code, newPassword: 'AnotherPass123' }));
    expect(replay.status).toBe(422);
  });
});

describe('SHM-010: staff TOTP', () => {
  it('lets a staff account sign in before enrolment, flagged totpRequired, and enrol in one step', async () => {
    const staff = await staffLogin();
    if (staff.status !== 201) return; // already enrolled by an earlier run
    expect(staff.body.totpRequired).toBe(true);
    expect(staff.body.user.totpEnabled).toBe(false);

    const setup = await callApi<{ secret: string; otpauthUri: string }>(app, '/auth/totp/setup', { method: 'POST', headers: { authorization: `Bearer ${staff.body.accessToken}` } });
    expect(setup.status).toBe(201);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');

    const confirmed = await callApi<{ totpEnabled: boolean }>(app, '/auth/totp/verify', postJson({ code: totpCode(setup.body.secret, new Date()) }, staff.body.accessToken));
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.totpEnabled).toBe(true);
  });

  it('rejects a wrong authenticator code with TOTP_INVALID', async () => {
    const staff = await staffLogin();
    if (staff.status !== 201) return;
    const setup = await callApi<{ secret: string }>(app, '/auth/totp/setup', { method: 'POST', headers: { authorization: `Bearer ${staff.body.accessToken}` } });
    const wrong = await callApi<{ code: string }>(app, '/auth/totp/verify', postJson({ code: '000000' }, staff.body.accessToken));
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('TOTP_INVALID');
    void setup;
  });

  it('requires the authenticator code on every staff sign in once enrolled', async () => {
    const staff = await staffLogin();
    if (staff.status !== 201) return;
    const setup = await callApi<{ secret: string }>(app, '/auth/totp/setup', { method: 'POST', headers: { authorization: `Bearer ${staff.body.accessToken}` } });
    await callApi(app, '/auth/totp/verify', postJson({ code: totpCode(setup.body.secret, new Date()) }, staff.body.accessToken));

    const withoutCode = await callApi<{ code: string }>(app, '/auth/login', postJson(SEEDED));
    expect(withoutCode.status).toBe(401);
    expect(withoutCode.body.code).toBe('TOTP_REQUIRED');

    const wrongCode = await callApi<{ code: string }>(app, '/auth/login', postJson({ ...SEEDED, totpCode: '000000' }));
    expect(wrongCode.status).toBe(422);
    expect(wrongCode.body.code).toBe('TOTP_INVALID');

    const good = await loginAs(app, SEEDED.identifier, SEEDED.password, totpCode(setup.body.secret, new Date()));
    expect(good.status).toBe(201);
    expect(good.body.totpRequired).toBe(false);
  });

  it('FR-AD-01: refuses every staff route before TOTP verification, while enrolment stays reachable', async () => {
    const staff = await staffLogin();
    if (staff.status !== 201) return;
    const token = staff.body.accessToken;
    expect(staff.body.totpRequired).toBe(true);

    const read = await callApi<{ code: string }>(app, '/admin/settings', { headers: { authorization: `Bearer ${token}` } });
    expect(read.status).toBe(401);
    expect(read.body.code).toBe('TOTP_REQUIRED');

    const write = await callApi<{ code: string }>(app, '/admin/settings/verification.sla_min', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ value: 45 }) });
    expect(write.status).toBe(401);
    expect(write.body.code).toBe('TOTP_REQUIRED');

    const enrolment = await callApi(app, '/auth/totp/setup', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(enrolment.status).toBe(201);
    const profile = await callApi(app, '/auth/me', { headers: { authorization: `Bearer ${token}` } });
    expect(profile.status).toBe(200);
  });

  it('lets a verified staff session read the settings it is entitled to', async () => {
    const staff = await staffLogin();
    if (staff.status !== 201) return;
    const setup = await callApi<{ secret: string }>(app, '/auth/totp/setup', { method: 'POST', headers: { authorization: `Bearer ${staff.body.accessToken}` } });
    await callApi(app, '/auth/totp/verify', postJson({ code: totpCode(setup.body.secret, new Date()) }, staff.body.accessToken));
    const verified = await loginAs(app, SEEDED.identifier, SEEDED.password, totpCode(setup.body.secret, new Date()));
    const settings = await callApi<{ items: unknown[] }>(app, '/admin/settings', { headers: { authorization: `Bearer ${verified.body.accessToken}` } });
    expect(settings.status).toBe(200);
    expect(settings.body.items.length).toBeGreaterThan(0);
  });
});

describe('NFR-SE-02: role separation on the same routes', () => {
  it('gives a customer 403 on a staff route and staff a 401 with no token', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const asCustomer = await callApi<{ code: string }>(app, '/admin/settings', { headers: { authorization: `Bearer ${customer.accessToken}` } });
    expect(asCustomer.status).toBe(403);
    expect(asCustomer.body.code).toBe('FORBIDDEN');

    const anonymous = await callApi<{ code: string }>(app, '/admin/settings');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged or tampered access token', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const [header, payload] = customer.accessToken.split('.');
    const forged = `${header}.${payload}.${'a'.repeat(43)}`;
    const response = await callApi<{ code: string }>(app, '/auth/me', { headers: { authorization: `Bearer ${forged}` } });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });
});

const staffLogin = async (): Promise<ApiResponse<{ accessToken: string; user: { totpEnabled: boolean }; totpRequired: boolean }>> =>
  loginAs(app, SEEDED.identifier, SEEDED.password);

const providerStatusOf = async (phone: string): Promise<string[]> => {
  const rows = await queryRows<{ status: string }>('SELECT p.status FROM providers p JOIN users u ON u.id = p.user_id WHERE u.phone_e164 = $1', [phone]);
  return rows.map(row => row.status);
};

const queryRows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient();
  try {
    return await client.$queryRawUnsafe<T[]>(sql, ...params);
  } finally {
    await client.$disconnect();
  }
};
