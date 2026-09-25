import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { callApi, createTestApp } from './harness.js';

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

describe('places: cities and areas', () => {
  it('lists the seeded active city for anonymous callers', async () => {
    const response = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
    expect(response.status).toBe(200);
    expect(response.body.items.map(item => item.name)).toContain('Lahore');
  });

  it('lists the areas within a city', async () => {
    const cities = await callApi<{ items: { id: number; name: string }[] }>(app, '/places/cities');
    const lahore = cities.body.items.find(item => item.name === 'Lahore')!;

    const response = await callApi<{ items: { name: string }[] }>(app, `/places/cities/${lahore.id}/areas`);
    expect(response.status).toBe(200);
    expect(response.body.items.map(item => item.name)).toContain('Gulberg');
  });

  it('rejects an unknown city id with NOT_FOUND', async () => {
    const response = await callApi<{ code: string }>(app, '/places/cities/999999/areas');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
