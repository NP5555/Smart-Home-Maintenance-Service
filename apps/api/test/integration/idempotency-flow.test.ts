import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { callApi, createTestApp, headerOf, postJson, registerAndVerify, type TestUser } from './harness.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let gulbergAreaId: number;
let customer: TestUser;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
  gulbergAreaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;
  customer = await registerAndVerify(app, 'CUSTOMER');
});

afterAll(async () => {
  await close();
});

const payload = (label: string) => ({
  label,
  line1: 'House 12, Street 4',
  areaId: gulbergAreaId,
  lat: 31.5204,
  lng: 74.3587,
  isDefault: false
});

const withKey = (body: unknown, key: string) => ({
  ...postJson(body, customer.accessToken),
  headers: { ...postJson(body, customer.accessToken).headers, 'idempotency-key': key }
});

/**
 * TRD §5.4 idempotency, exercised over real HTTP. The interceptor replays a
 * stored response by setting the status and returning the body, and Nest then
 * serialises that result; a unit test of the helper functions cannot see
 * whether the two writes collide, so these are the assertions that prove the
 * replay still returns the original body, status and marker header.
 */
describe('TRD §5.4: idempotent writes over HTTP', () => {
  it('stores the first response and replays it for the same key', async () => {
    const key = `create-address-${crypto.randomUUID()}`;
    const body = payload('Replayed');

    const first = await callApi<{ id: string; label: string }>(app, '/customer/addresses', withKey(body, key));
    expect(first.status).toBe(201);
    expect(first.body.label).toBe('Replayed');

    const second = await callApi<{ id: string; label: string }>(app, '/customer/addresses', withKey(body, key));
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    // A replay must not create a second row.
    const listed = await callApi<{ items: { id: string; label: string }[] }>(app, '/customer/addresses', { headers: { authorization: `Bearer ${customer.accessToken}` } });
    expect(listed.body.items.filter(item => item.label === 'Replayed')).toHaveLength(1);
  });

  it('marks a replay with the idempotency-replayed header and a first write with false', async () => {
    const key = `create-address-${crypto.randomUUID()}`;
    const body = payload('Header');

    const first = await callApi<{ id: string }>(app, '/customer/addresses', withKey(body, key));
    const second = await callApi<{ id: string }>(app, '/customer/addresses', withKey(body, key));

    expect(first.body.id).toBe(second.body.id);
    expect(headerOf(first, 'idempotency-replayed')).toBe('false');
    expect(headerOf(second, 'idempotency-replayed')).toBe('true');
  });

  it('rejects the same key carrying a different body', async () => {
    const key = `create-address-${crypto.randomUUID()}`;
    const first = await callApi(app, '/customer/addresses', withKey(payload('Original'), key));
    expect(first.status).toBe(201);

    const conflicting = await callApi<{ code: string }>(app, '/customer/addresses', withKey(payload('Different'), key));
    expect(conflicting.status).toBe(422);
    expect(conflicting.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('scopes keys per user so two customers cannot collide', async () => {
    const other = await registerAndVerify(app, 'CUSTOMER');
    const key = `create-address-${crypto.randomUUID()}`;

    const mine = await callApi(app, '/customer/addresses', withKey(payload('Mine'), key));
    const theirs = await callApi(app, '/customer/addresses', {
      ...postJson(payload('Theirs'), other.accessToken),
      headers: { ...postJson(payload('Theirs'), other.accessToken).headers, 'idempotency-key': key }
    });
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
  });

  it('leaves a request without a key unaffected', async () => {
    const created = await callApi<{ label: string }>(app, '/customer/addresses', postJson(payload('NoKey'), customer.accessToken));
    expect(created.status).toBe(201);

    const again = await callApi<{ label: string }>(app, '/customer/addresses', postJson(payload('NoKey'), customer.accessToken));
    expect(again.status).toBe(201);
    expect(again.body.label).toBe('NoKey');
  });
});
