import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { adminSession, callApi, createTestApp, deleteWith, patchJson, postJson, putJson, registerAndVerify } from './harness.js';

let app: NestFastifyApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  admin = await adminSession(app);
});

afterAll(async () => {
  await close();
});

const asAdmin = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${admin.accessToken}` } });

describe('FR-CAT-01/02: catalogue categories', () => {
  it('lists only active seeded categories, ordered, for anonymous callers', async () => {
    const response = await callApi<{ items: { slug: string; nameEn: string; isActive?: boolean }[] }>(app, '/catalogue/categories');
    expect(response.status).toBe(200);
    const slugs = response.body.items.map(item => item.slug);
    expect(slugs).toContain('plumbing');
    expect(slugs).not.toContain('security-smart-home'); // seeded inactive
    expect(slugs).not.toContain('carpentry-legacy'); // seeded inactive
  });

  it('lets an admin create a category, which then appears in the public listing', async () => {
    const slug = `test-cat-${randomUUID().slice(0, 8)}`;
    const created = await callApi<{ id: number; slug: string }>(app, '/admin/catalogue/categories', asAdmin(postJson({ slug, nameEn: 'Test Category', nameUr: 'ٹیسٹ', defaultWarrantyDays: 10 })));
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe(slug);

    const listed = await callApi<{ items: { slug: string }[] }>(app, '/catalogue/categories');
    expect(listed.body.items.map(item => item.slug)).toContain(slug);
  });

  it('rejects a duplicate category slug with CONFLICT', async () => {
    const slug = `test-cat-${randomUUID().slice(0, 8)}`;
    await callApi(app, '/admin/catalogue/categories', asAdmin(postJson({ slug, nameEn: 'One', nameUr: 'ایک', defaultWarrantyDays: 0 })));
    const dupe = await callApi<{ code: string }>(app, '/admin/catalogue/categories', asAdmin(postJson({ slug, nameEn: 'Two', nameUr: 'دو', defaultWarrantyDays: 0 })));
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('CONFLICT');
  });

  it('rejects category writes from a signed in customer', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ code: string }>(app, '/admin/catalogue/categories', postJson({ slug: 'nope', nameEn: 'Nope', nameUr: 'نہیں', defaultWarrantyDays: 0 }, customer.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('lets an admin update a category and deactivate it out of the public listing', async () => {
    const slug = `test-cat-${randomUUID().slice(0, 8)}`;
    const created = await callApi<{ id: number }>(app, '/admin/catalogue/categories', asAdmin(postJson({ slug, nameEn: 'Temp', nameUr: 'عارضی', defaultWarrantyDays: 0 })));

    const updated = await callApi<{ nameEn: string; isActive: boolean }>(app, `/admin/catalogue/categories/${created.body.id}`, asAdmin(patchJson({ nameEn: 'Renamed', isActive: false })));
    expect(updated.status).toBe(200);
    expect(updated.body.nameEn).toBe('Renamed');
    expect(updated.body.isActive).toBe(false);

    const listed = await callApi<{ items: { slug: string }[] }>(app, '/catalogue/categories');
    expect(listed.body.items.map(item => item.slug)).not.toContain(slug);
  });
});

const newTestCategory = async (): Promise<{ id: number; slug: string }> => {
  const slug = `test-cat-${randomUUID().slice(0, 8)}`;
  const created = await callApi<{ id: number }>(app, '/admin/catalogue/categories', asAdmin(postJson({ slug, nameEn: 'Test Category', nameUr: 'ٹیسٹ', defaultWarrantyDays: 0 })));
  return { id: created.body.id, slug };
};

const flatServicePayload = (categoryId: number, slug: string) => ({
  categoryId,
  slug,
  nameEn: 'Test Service',
  nameUr: 'ٹیسٹ سروس',
  description: 'A service created for tests.',
  pricingModel: 'FLAT' as const,
  basePricePaisa: 250_00,
  minPricePaisa: 100_00,
  maxPricePaisa: 500_00,
  expectedDurationMin: 60
});

describe('FR-CAT-01/02/06/07: catalogue services', () => {
  it('lists only active seeded services for a category, and rejects an unknown category slug with NOT_FOUND', async () => {
    const found = await callApi<{ items: { slug: string }[] }>(app, '/catalogue/categories/plumbing/services');
    expect(found.status).toBe(200);
    expect(found.body.items.map(item => item.slug)).toContain('leak-repair');

    const missing = await callApi<{ code: string }>(app, '/catalogue/categories/does-not-exist/services');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('returns a service detail with its ordered checklist for anonymous callers', async () => {
    const response = await callApi<{ slug: string; pricingModel: string; checklist: { labelEn: string; position: number }[] }>(app, '/catalogue/services/leak-repair');
    expect(response.status).toBe(200);
    expect(response.body.pricingModel).toBe('FLAT');
    expect(response.body.checklist.length).toBeGreaterThan(0);
    const positions = response.body.checklist.map(item => item.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('lets an admin create a FLAT service under a category, visible in the category listing', async () => {
    const category = await newTestCategory();
    const slug = `test-svc-${randomUUID().slice(0, 8)}`;
    const created = await callApi<{ id: number; slug: string; basePricePaisa: number }>(app, '/admin/catalogue/services', asAdmin(postJson(flatServicePayload(category.id, slug))));
    expect(created.status).toBe(201);
    expect(created.body.basePricePaisa).toBe(25_000);

    const listed = await callApi<{ items: { slug: string }[] }>(app, `/catalogue/categories/${category.slug}/services`);
    expect(listed.body.items.map(item => item.slug)).toContain(slug);
  });

  it('rejects a service whose base price falls outside its own min/max band', async () => {
    const category = await newTestCategory();
    const payload = { ...flatServicePayload(category.id, `test-svc-${randomUUID().slice(0, 8)}`), basePricePaisa: 999_999 };
    const response = await callApi<{ code: string }>(app, '/admin/catalogue/services', asAdmin(postJson(payload)));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a TIME_BASED service that omits the time unit', async () => {
    const category = await newTestCategory();
    const payload = { ...flatServicePayload(category.id, `test-svc-${randomUUID().slice(0, 8)}`), pricingModel: 'TIME_BASED' as const };
    const response = await callApi<{ code: string }>(app, '/admin/catalogue/services', asAdmin(postJson(payload)));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('lets an admin update and deactivate a service, hiding it from the public detail endpoint', async () => {
    const category = await newTestCategory();
    const slug = `test-svc-${randomUUID().slice(0, 8)}`;
    const created = await callApi<{ id: number }>(app, '/admin/catalogue/services', asAdmin(postJson(flatServicePayload(category.id, slug))));

    const updated = await callApi<{ nameEn: string; isActive: boolean }>(app, `/admin/catalogue/services/${created.body.id}`, asAdmin(patchJson({ nameEn: 'Renamed Service', isActive: false })));
    expect(updated.status).toBe(200);
    expect(updated.body.isActive).toBe(false);

    const detail = await callApi<{ code: string }>(app, `/catalogue/services/${slug}`);
    expect(detail.status).toBe(404);
  });

  it('lets an admin replace a service checklist, which then appears in order on the public detail', async () => {
    const category = await newTestCategory();
    const slug = `test-svc-${randomUUID().slice(0, 8)}`;
    const created = await callApi<{ id: number }>(app, '/admin/catalogue/services', asAdmin(postJson(flatServicePayload(category.id, slug))));

    const replaced = await callApi<{ items: { position: number; labelEn: string }[] }>(
      app,
      `/admin/catalogue/services/${created.body.id}/checklist`,
      asAdmin(
        putJson({
          items: [
            { labelEn: 'Step one', labelUr: 'مرحلہ اول', requiresPhoto: false },
            { labelEn: 'Step two', labelUr: 'مرحلہ دوم', requiresPhoto: true }
          ]
        })
      )
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body.items.map(item => item.labelEn)).toEqual(['Step one', 'Step two']);

    const detail = await callApi<{ checklist: { labelEn: string }[] }>(app, `/catalogue/services/${slug}`);
    expect(detail.body.checklist.map(item => item.labelEn)).toEqual(['Step one', 'Step two']);
  });
});

describe('FR-CAT-05: commission rules', () => {
  it('lets an admin set a GLOBAL commission rate, listable by scope', async () => {
    const created = await callApi<{ id: string; scope: string; rateBp: number }>(app, '/admin/catalogue/commission-rules', asAdmin(postJson({ scope: 'GLOBAL', rateBp: 1_500 })));
    expect(created.status).toBe(201);
    expect(created.body.rateBp).toBe(1_500);

    const listed = await callApi<{ items: { id: string }[] }>(app, '/admin/catalogue/commission-rules?scope=GLOBAL', asAdmin());
    expect(listed.body.items.map(item => item.id)).toContain(created.body.id);
  });

  it('lets an admin set a CATEGORY commission rate bound to a real category', async () => {
    const category = await newTestCategory();
    const created = await callApi<{ scope: string; categoryId: number }>(app, '/admin/catalogue/commission-rules', asAdmin(postJson({ scope: 'CATEGORY', categoryId: category.id, rateBp: 2_000 })));
    expect(created.status).toBe(201);
    expect(created.body.categoryId).toBe(category.id);
  });

  it('rejects a CATEGORY scope rule that omits categoryId', async () => {
    const response = await callApi<{ code: string }>(app, '/admin/catalogue/commission-rules', asAdmin(postJson({ scope: 'CATEGORY', rateBp: 2_000 })));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a PROVIDER scope rule for a provider that does not exist', async () => {
    const response = await callApi<{ code: string }>(app, '/admin/catalogue/commission-rules', asAdmin(postJson({ scope: 'PROVIDER', providerId: randomUUID(), rateBp: 2_000 })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('lets an admin close a commission rule, stamping effectiveTo', async () => {
    const created = await callApi<{ id: string }>(app, '/admin/catalogue/commission-rules', asAdmin(postJson({ scope: 'GLOBAL', rateBp: 500 })));
    const ended = await callApi<{ effectiveTo: string | null }>(app, `/admin/catalogue/commission-rules/${created.body.id}/end`, asAdmin({ method: 'POST' }));
    expect(ended.status).toBe(200);
    expect(ended.body.effectiveTo).not.toBeNull();
  });

  it('rejects commission rule writes from a signed in customer', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ code: string }>(app, '/admin/catalogue/commission-rules', postJson({ scope: 'GLOBAL', rateBp: 500 }, customer.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});

describe('FR-CAT-03/04: provider expertise and pricing', () => {
  it('lets a provider offer an active service at a price within its band, pending approval', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const service = (await callApi<{ id: number; minPricePaisa: number; maxPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;

    const created = await callApi<{ serviceId: number; pricePaisa: number; status: string }>(app, `/provider/services/${service.id}`, putJson({ pricePaisa: service.minPricePaisa }, provider.accessToken));
    expect(created.status).toBe(200);
    expect(created.body.status).toBe('PENDING');
    expect(created.body.pricePaisa).toBe(service.minPricePaisa);

    const mine = await callApi<{ items: { serviceId: number }[] }>(app, '/provider/services', { headers: { authorization: `Bearer ${provider.accessToken}` } });
    expect(mine.body.items.map(item => item.serviceId)).toContain(service.id);
  });

  it('lets a provider update their price without resetting an existing status', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const service = (await callApi<{ id: number; minPricePaisa: number; maxPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
    await callApi(app, `/provider/services/${service.id}`, putJson({ pricePaisa: service.minPricePaisa }, provider.accessToken));
    await callApi(app, `/admin/provider-services/${provider.id}/${service.id}/approve`, asAdmin({ method: 'POST' }));

    const updated = await callApi<{ pricePaisa: number; status: string }>(app, `/provider/services/${service.id}`, putJson({ pricePaisa: service.maxPricePaisa }, provider.accessToken));
    expect(updated.body.pricePaisa).toBe(service.maxPricePaisa);
    expect(updated.body.status).toBe('APPROVED');
  });

  it('rejects a price outside the service band', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const service = (await callApi<{ id: number; maxPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
    const response = await callApi<{ code: string }>(app, `/provider/services/${service.id}`, putJson({ pricePaisa: service.maxPricePaisa + 1 }, provider.accessToken));
    expect(response.status).toBe(400);
  });

  it('lets a provider remove their own binding', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const service = (await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
    await callApi(app, `/provider/services/${service.id}`, putJson({ pricePaisa: service.minPricePaisa }, provider.accessToken));

    const removed = await callApi(app, `/provider/services/${service.id}`, deleteWith(provider.accessToken));
    expect(removed.status).toBe(204);

    const mine = await callApi<{ items: { serviceId: number }[] }>(app, '/provider/services', { headers: { authorization: `Bearer ${provider.accessToken}` } });
    expect(mine.body.items.map(item => item.serviceId)).not.toContain(service.id);
  });

  it('lets an admin review and approve or reject pending provider bindings', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const service = (await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
    await callApi(app, `/provider/services/${service.id}`, putJson({ pricePaisa: service.minPricePaisa }, provider.accessToken));

    const pending = await callApi<{ items: { providerId: string; serviceId: number }[] }>(app, '/admin/provider-services?status=PENDING', asAdmin());
    expect(pending.body.items.some(item => item.providerId === provider.id && item.serviceId === service.id)).toBe(true);

    const rejected = await callApi<{ status: string }>(app, `/admin/provider-services/${provider.id}/${service.id}/reject`, asAdmin({ method: 'POST' }));
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('REJECTED');
  });

  it('rejects provider binding writes from a signed in customer', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const service = (await callApi<{ id: number; minPricePaisa: number }>(app, '/catalogue/services/leak-repair')).body;
    const response = await callApi<{ code: string }>(app, `/provider/services/${service.id}`, putJson({ pricePaisa: service.minPricePaisa }, customer.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
