import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { callApi, createTestApp, deleteWith, patchJson, postJson, registerAndVerify } from './harness.js';

let app: NestFastifyApplication;
let close: () => Promise<void>;
let gulbergAreaId: number;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
  gulbergAreaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;
});

afterAll(async () => {
  await close();
});

const addressPayload = (overrides: Partial<{ label: string; areaId: number; isDefault: boolean }> = {}) => ({
  label: overrides.label ?? 'Home',
  line1: 'House 12, Street 4',
  areaId: overrides.areaId ?? gulbergAreaId,
  lat: 31.5204,
  lng: 74.3587,
  isDefault: overrides.isDefault ?? false
});

describe('FR-CU-05: customer addresses', () => {
  it('lets a customer create an address and read the lat/lng back out', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const created = await callApi<{ id: string; label: string; lat: number; lng: number; areaId: number }>(app, '/customer/addresses', postJson(addressPayload(), customer.accessToken));
    expect(created.status).toBe(201);
    expect(created.body.label).toBe('Home');
    expect(created.body.areaId).toBe(gulbergAreaId);
    expect(created.body.lat).toBeCloseTo(31.5204, 3);
    expect(created.body.lng).toBeCloseTo(74.3587, 3);

    const listed = await callApi<{ items: { id: string }[] }>(app, '/customer/addresses', { headers: { authorization: `Bearer ${customer.accessToken}` } });
    expect(listed.body.items.map(item => item.id)).toContain(created.body.id);
  });

  it('rejects an address in an unknown area with NOT_FOUND', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ code: string }>(app, '/customer/addresses', postJson(addressPayload({ areaId: 999_999 }), customer.accessToken));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('keeps only one default address, swapping it on update', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const first = await callApi<{ id: string; isDefault: boolean }>(app, '/customer/addresses', postJson(addressPayload({ label: 'First', isDefault: true }), customer.accessToken));
    expect(first.body.isDefault).toBe(true);

    const second = await callApi<{ id: string; isDefault: boolean }>(app, '/customer/addresses', postJson(addressPayload({ label: 'Second', isDefault: true }), customer.accessToken));
    expect(second.body.isDefault).toBe(true);

    const listed = await callApi<{ items: { id: string; isDefault: boolean }[] }>(app, '/customer/addresses', { headers: { authorization: `Bearer ${customer.accessToken}` } });
    const firstNow = listed.body.items.find(item => item.id === first.body.id)!;
    expect(firstNow.isDefault).toBe(false);
  });

  it('lets a customer update an address label without touching its location', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const created = await callApi<{ id: string; lat: number }>(app, '/customer/addresses', postJson(addressPayload(), customer.accessToken));
    const updated = await callApi<{ label: string; lat: number }>(app, `/customer/addresses/${created.body.id}`, patchJson({ label: 'Office' }, customer.accessToken));
    expect(updated.status).toBe(200);
    expect(updated.body.label).toBe('Office');
    expect(updated.body.lat).toBeCloseTo(created.body.lat, 3);
  });

  it('archives an address so it drops out of the listing, and refuses a second archive with NOT_FOUND', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const created = await callApi<{ id: string }>(app, '/customer/addresses', postJson(addressPayload(), customer.accessToken));

    const archived = await callApi(app, `/customer/addresses/${created.body.id}`, deleteWith(customer.accessToken));
    expect(archived.status).toBe(204);

    const listed = await callApi<{ items: { id: string }[] }>(app, '/customer/addresses', { headers: { authorization: `Bearer ${customer.accessToken}` } });
    expect(listed.body.items.map(item => item.id)).not.toContain(created.body.id);

    const again = await callApi<{ code: string }>(app, `/customer/addresses/${created.body.id}`, deleteWith(customer.accessToken));
    expect(again.status).toBe(404);
  });

  it("rejects one customer from reading or changing another customer's address", async () => {
    const owner = await registerAndVerify(app, 'CUSTOMER');
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    const created = await callApi<{ id: string }>(app, '/customer/addresses', postJson(addressPayload(), owner.accessToken));

    const strangerUpdate = await callApi<{ code: string }>(app, `/customer/addresses/${created.body.id}`, patchJson({ label: 'Hijacked' }, stranger.accessToken));
    expect(strangerUpdate.status).toBe(404);

    const strangerList = await callApi<{ items: { id: string }[] }>(app, '/customer/addresses', { headers: { authorization: `Bearer ${stranger.accessToken}` } });
    expect(strangerList.body.items.map(item => item.id)).not.toContain(created.body.id);
  });

  it('rejects address writes from a signed in provider', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, '/customer/addresses', postJson(addressPayload(), provider.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
