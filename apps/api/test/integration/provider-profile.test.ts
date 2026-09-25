import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { adminSession, callApi, createTestApp, deleteWith, patchJson, postJson, putJson, registerAndVerify } from './harness.js';

let app: NestFastifyApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };
let lahoreCityId: number;
let gulbergAreaId: number;
let joharTownAreaId: number;

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  admin = await adminSession(app);
  const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
  const lahore = cities.body.items.find(item => item.name === 'Lahore')!;
  lahoreCityId = lahore.id;
  const areas = await callApi<{ items: { id: number; name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
  gulbergAreaId = areas.body.items.find(item => item.name === 'Gulberg')!.id;
  joharTownAreaId = areas.body.items.find(item => item.name === 'Johar Town')!.id;
});

afterAll(async () => {
  await close();
});

const asProvider = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

describe('FR-SP-02/03: provider profile', () => {
  it('reads a freshly registered provider back with empty profile fields and the default radius', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ status: string; bio: string | null; radiusM: number }>(app, '/provider/profile', asProvider(provider.accessToken));
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PENDING_APPROVAL');
    expect(response.body.bio).toBeNull();
    expect(response.body.radiusM).toBe(8000);
  });

  it('lets a provider fill in and read back their profile, including the base location', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const updated = await callApi<{ bio: string; cityId: number; lat: number; lng: number; radiusM: number }>(
      app,
      '/provider/profile',
      asProvider(provider.accessToken, patchJson({ bio: 'Experienced plumber', experienceYears: 5, qualification: 'Trade certified', cityId: lahoreCityId, baseAddressText: 'Gulberg III', lat: 31.5, lng: 74.35, radiusM: 12_000 }))
    );
    expect(updated.status).toBe(200);
    expect(updated.body.bio).toBe('Experienced plumber');
    expect(updated.body.cityId).toBe(lahoreCityId);
    expect(updated.body.lat).toBeCloseTo(31.5, 3);
    expect(updated.body.radiusM).toBe(12_000);

    const read = await callApi<{ bio: string }>(app, '/provider/profile', asProvider(provider.accessToken));
    expect(read.body.bio).toBe('Experienced plumber');
  });

  it('rejects an unknown cityId with NOT_FOUND', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, '/provider/profile', asProvider(provider.accessToken, patchJson({ cityId: 999_999 })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects profile access from a signed in customer', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ code: string }>(app, '/provider/profile', asProvider(customer.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});

describe('FR-SP-07: provider availability calendar', () => {
  it('lets a provider set a weekly availability calendar and read it back in order', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const replaced = await callApi<{ items: { weekday: number; startTime: string; endTime: string }[] }>(
      app,
      '/provider/availability',
      asProvider(
        provider.accessToken,
        putJson({
          items: [
            { weekday: 2, startTime: '09:00', endTime: '17:00' },
            { weekday: 0, startTime: '10:00', endTime: '14:00' }
          ]
        })
      )
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body.items.map(item => item.weekday)).toEqual([0, 2]);

    const read = await callApi<{ items: { weekday: number }[] }>(app, '/provider/availability', asProvider(provider.accessToken));
    expect(read.body.items.map(item => item.weekday)).toEqual([0, 2]);
  });

  it('rejects a slot where startTime is not before endTime', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, '/provider/availability', asProvider(provider.accessToken, putJson({ items: [{ weekday: 1, startTime: '17:00', endTime: '09:00' }] })));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('replacing the calendar again drops the previous slots', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/availability', asProvider(provider.accessToken, putJson({ items: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] })));
    const second = await callApi<{ items: { weekday: number }[] }>(app, '/provider/availability', asProvider(provider.accessToken, putJson({ items: [{ weekday: 5, startTime: '08:00', endTime: '12:00' }] })));
    expect(second.body.items.map(item => item.weekday)).toEqual([5]);
  });
});

describe('FR-SP-07: provider time off', () => {
  it('lets a provider record a leave period and list it', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const created = await callApi<{ id: string; start: string; end: string }>(
      app,
      '/provider/time-off',
      asProvider(provider.accessToken, postJson({ start: '2027-01-10T00:00:00.000Z', end: '2027-01-12T00:00:00.000Z', reason: 'Eid holidays' }))
    );
    expect(created.status).toBe(201);

    const listed = await callApi<{ items: { id: string }[] }>(app, '/provider/time-off', asProvider(provider.accessToken));
    expect(listed.body.items.map(item => item.id)).toContain(created.body.id);
  });

  it('rejects an overlapping leave period with CONFLICT', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/time-off', asProvider(provider.accessToken, postJson({ start: '2027-02-01T00:00:00.000Z', end: '2027-02-05T00:00:00.000Z' })));
    const overlapping = await callApi<{ code: string }>(app, '/provider/time-off', asProvider(provider.accessToken, postJson({ start: '2027-02-03T00:00:00.000Z', end: '2027-02-06T00:00:00.000Z' })));
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.code).toBe('CONFLICT');
  });

  it('lets a provider cancel their own leave period', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const created = await callApi<{ id: string }>(app, '/provider/time-off', asProvider(provider.accessToken, postJson({ start: '2027-03-01T00:00:00.000Z', end: '2027-03-02T00:00:00.000Z' })));
    const cancelled = await callApi(app, `/provider/time-off/${created.body.id}`, asProvider(provider.accessToken, deleteWith()));
    expect(cancelled.status).toBe(204);

    const listed = await callApi<{ items: { id: string }[] }>(app, '/provider/time-off', asProvider(provider.accessToken));
    expect(listed.body.items.map(item => item.id)).not.toContain(created.body.id);
  });
});

describe('FR-SP-08: provider service areas', () => {
  it('lets a provider set which areas they serve and read them back', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const replaced = await callApi<{ items: { areaId: number }[] }>(app, '/provider/service-areas', asProvider(provider.accessToken, putJson({ areaIds: [gulbergAreaId, joharTownAreaId] })));
    expect(replaced.status).toBe(200);
    expect(replaced.body.items.map(item => item.areaId).sort()).toEqual([gulbergAreaId, joharTownAreaId].sort());

    const read = await callApi<{ items: { areaId: number }[] }>(app, '/provider/service-areas', asProvider(provider.accessToken));
    expect(read.body.items.map(item => item.areaId).sort()).toEqual([gulbergAreaId, joharTownAreaId].sort());
  });

  it('rejects an unknown area id with NOT_FOUND', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, '/provider/service-areas', asProvider(provider.accessToken, putJson({ areaIds: [999_999] })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('replacing the service areas again drops the previous set', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await callApi(app, '/provider/service-areas', asProvider(provider.accessToken, putJson({ areaIds: [gulbergAreaId] })));
    const second = await callApi<{ items: { areaId: number }[] }>(app, '/provider/service-areas', asProvider(provider.accessToken, putJson({ areaIds: [joharTownAreaId] })));
    expect(second.body.items.map(item => item.areaId)).toEqual([joharTownAreaId]);
  });
});

const asAdmin = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` } });

describe('FR-AD-02: provider approval', () => {
  it('lets an admin approve a pending provider', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const approved = await callApi<{ status: string; approvedAt: string | null }>(app, `/admin/providers/${provider.id}/approve`, asAdmin({ method: 'POST' }));
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedAt).not.toBeNull();

    const profile = await callApi<{ status: string }>(app, '/provider/profile', asProvider(provider.accessToken));
    expect(profile.body.status).toBe('APPROVED');
  });

  it('lets an admin reject a provider with a reason', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const rejected = await callApi<{ status: string; rejectionReason: string | null }>(app, `/admin/providers/${provider.id}/reject`, asAdmin(postJson({ reason: 'Documents unclear' })));
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toBe('Documents unclear');
  });

  it('rejects provider approval from a signed in customer', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ code: string }>(app, `/admin/providers/${provider.id}/approve`, postJson({}, customer.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects approving an unknown provider id with NOT_FOUND', async () => {
    const response = await callApi<{ code: string }>(app, '/admin/providers/00000000-0000-4000-8000-000000000000/approve', asAdmin({ method: 'POST' }));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
