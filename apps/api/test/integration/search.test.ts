import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { adminSession, callApi, createTestApp, patchJson, putJson, registerAndVerify, type TestUser } from './harness.js';

let app: NestFastifyApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };
let leakRepair: { id: number; minPricePaisa: number };
let gulbergAreaId: number;

const BASE_LAT = 31.5204;
const BASE_LNG = 74.3587;
const FAR_LAT = 32.0836; // Faisalabad-ish, well outside a small radius
const FAR_LNG = 72.6711;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  admin = await adminSession(app);
  leakRepair = (await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
  gulbergAreaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;
});

afterAll(async () => {
  await close();
});

const asAdmin = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` } });
const asProvider = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

/** A provider fully set up and approved to offer leak-repair, centred on BASE_LAT/BASE_LNG with a small radius. */
const readyProvider = async (radiusM = 5000): Promise<TestUser> => {
  const provider = await registerAndVerify(app, 'PROVIDER');
  await callApi(app, '/provider/profile', asProvider(provider.accessToken, patchJson({ bio: 'Search test provider', cityId: 1, baseAddressText: 'Gulberg', lat: BASE_LAT, lng: BASE_LNG, radiusM })));
  await callApi(app, '/provider/service-areas', asProvider(provider.accessToken, putJson({ areaIds: [gulbergAreaId] })));
  await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa }, provider.accessToken));
  await callApi(app, `/admin/provider-services/${provider.id}/${leakRepair.id}/approve`, asAdmin({ method: 'POST' }));
  await callApi(app, `/admin/providers/${provider.id}/approve`, asAdmin({ method: 'POST' }));
  return provider;
};

describe('FR-SR-03/04/06: provider search', () => {
  it('finds a ready, in-range provider and reports a small distance', async () => {
    const provider = await readyProvider();
    const response = await callApi<{ items: { providerId: string; distanceM: number; pricePaisa: number }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.status).toBe(200);
    const match = response.body.items.find(item => item.providerId === provider.id);
    expect(match).toBeDefined();
    expect(match!.distanceM).toBeLessThan(100);
    expect(match!.pricePaisa).toBe(leakRepair.minPricePaisa);
  });

  it('excludes a provider whose search point falls outside their radius', async () => {
    const provider = await readyProvider(1000);
    const response = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${FAR_LAT}&lng=${FAR_LNG}`);
    expect(response.body.items.map(item => item.providerId)).not.toContain(provider.id);
  });

  it('excludes a provider whose account is not yet approved', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/profile', asProvider(provider.accessToken, patchJson({ lat: BASE_LAT, lng: BASE_LNG, radiusM: 5000 })));
    await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa }, provider.accessToken));
    await callApi(app, `/admin/provider-services/${provider.id}/${leakRepair.id}/approve`, asAdmin({ method: 'POST' }));
    // provider account itself is never approved

    const response = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.body.items.map(item => item.providerId)).not.toContain(provider.id);
  });

  it('excludes a provider whose offer to provide the service is still pending', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/profile', asProvider(provider.accessToken, patchJson({ lat: BASE_LAT, lng: BASE_LNG, radiusM: 5000 })));
    await callApi(app, `/provider/services/${leakRepair.id}`, putJson({ pricePaisa: leakRepair.minPricePaisa }, provider.accessToken));
    await callApi(app, `/admin/providers/${provider.id}/approve`, asAdmin({ method: 'POST' }));
    // the provider_services binding is never approved

    const response = await callApi<{ items: { providerId: string }[] }>(app, `/search/providers?serviceSlug=leak-repair&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.body.items.map(item => item.providerId)).not.toContain(provider.id);
  });

  it('rejects an unknown service slug with NOT_FOUND', async () => {
    const response = await callApi<{ code: string }>(app, `/search/providers?serviceSlug=does-not-exist&lat=${BASE_LAT}&lng=${BASE_LNG}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});

describe('FR-SR-02: provider detail', () => {
  it("returns an approved provider's full detail with services and areas", async () => {
    const provider = await readyProvider();
    const response = await callApi<{ providerId: string; bio: string; services: { slug: string }[]; areas: { areaId: number }[] }>(app, `/search/providers/${provider.id}`);
    expect(response.status).toBe(200);
    expect(response.body.bio).toBe('Search test provider');
    expect(response.body.services.map(item => item.slug)).toContain('leak-repair');
    expect(response.body.areas.map(item => item.areaId)).toContain(gulbergAreaId);
  });

  it('hides an unapproved provider behind NOT_FOUND', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, `/search/providers/${provider.id}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
