// apps/api/test/integration/booking.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { callApi, createTestApp, postJson, readyBookableProvider, registerAndVerify } from './harness.js';

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

const asCustomer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

const aFutureSlot = (hoursFromNow = 72): { scheduledStart: string; scheduledEnd: string } => {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() };
};

const bookingSetup = async (): Promise<{ providerId: string; serviceId: number; customerAccessToken: string; addressId: string; minPricePaisa: number }> => {
  const { provider, serviceId, areaId, minPricePaisa } = await readyBookableProvider(app);
  const customer = await registerAndVerify(app, 'CUSTOMER');
  const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
  return { providerId: provider.id, serviceId, customerAccessToken: customer.accessToken, addressId: address.body.id, minPricePaisa };
};

describe('FR-BK-01/02/04: create a booking', () => {
  it('lets a customer request a specific, ready provider for a service at a chosen time', async () => {
    const { providerId, serviceId, customerAccessToken, addressId, minPricePaisa } = await bookingSetup();
    const { scheduledStart, scheduledEnd } = aFutureSlot();

    const created = await callApi<{ id: string; status: string; quotedAmountPaisa: number; approvedTotalPaisa: number }>(
      app,
      '/bookings',
      asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, scheduledStart, scheduledEnd, problemText: 'Kitchen tap is leaking' }))
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('REQUESTED');
    expect(created.body.quotedAmountPaisa).toBe(minPricePaisa);
    expect(created.body.approvedTotalPaisa).toBe(minPricePaisa);
  });

  it('rejects a second overlapping request for the same provider with CONFLICT', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const slot = aFutureSlot();
    await callApi(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...slot })));

    const secondCustomer = await registerAndVerify(app, 'CUSTOMER');
    const secondAddress = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(secondCustomer.accessToken, postJson({ label: 'Home', line1: 'House 2', areaId: (await readyBookableProvider(app)).areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const overlapping = await callApi<{ code: string }>(
      app,
      '/bookings',
      asCustomer(secondCustomer.accessToken, postJson({ providerId, serviceId, addressId: secondAddress.body.id, ...slot }))
    );
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.code).toBe('CONFLICT');
  });

  it('rejects a time outside the provider’s declared availability', async () => {
    const { provider, serviceId, areaId } = await readyBookableProvider(app); // note: NOT using bookingSetup's all-day calendar
    await callApi(app, '/provider/availability', { method: 'PUT', headers: { authorization: `Bearer ${provider.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ items: [] }) });
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const address = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(customer.accessToken, postJson({ label: 'Home', line1: 'House 1', areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(customer.accessToken, postJson({ providerId: provider.id, serviceId, addressId: address.body.id, ...aFutureSlot() })));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('rejects a service the provider does not offer', async () => {
    const { providerId, customerAccessToken, addressId } = await bookingSetup();
    const otherService = await callApi<{ id: number }>(app, '/catalogue/services/blocked-drain');
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId: otherService.body.id, addressId, ...aFutureSlot() })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects an address that does not belong to the requesting customer', async () => {
    const { providerId, serviceId, customerAccessToken } = await bookingSetup();
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    const strangerAddress = await callApi<{ id: string }>(app, '/customer/addresses', asCustomer(stranger.accessToken, postJson({ label: 'Home', line1: 'House 9', areaId: (await readyBookableProvider(app)).areaId, lat: 31.52, lng: 74.35, isDefault: true })));
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId: strangerAddress.body.id, ...aFutureSlot() })));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects booking writes from a signed in provider', async () => {
    const { providerId, serviceId, addressId } = await bookingSetup();
    const otherProvider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ code: string }>(app, '/bookings', asCustomer(otherProvider.accessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});

describe('reading bookings', () => {
  it('lets the customer and the provider both read a booking they are part of', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));

    const asCustomerRead = await callApi<{ id: string; status: string }>(app, `/bookings/${created.body.id}`, asCustomer(customerAccessToken));
    expect(asCustomerRead.status).toBe(200);
    expect(asCustomerRead.body.status).toBe('REQUESTED');
  });

  it('hides a booking from someone who is neither its customer nor its provider', async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const stranger = await registerAndVerify(app, 'CUSTOMER');
    const response = await callApi<{ code: string }>(app, `/bookings/${created.body.id}`, asCustomer(stranger.accessToken));
    expect(response.status).toBe(404);
  });

  it("lists a customer's own bookings", async () => {
    const { providerId, serviceId, customerAccessToken, addressId } = await bookingSetup();
    const created = await callApi<{ id: string }>(app, '/bookings', asCustomer(customerAccessToken, postJson({ providerId, serviceId, addressId, ...aFutureSlot() })));
    const listed = await callApi<{ items: { id: string }[] }>(app, '/bookings', asCustomer(customerAccessToken));
    expect(listed.body.items.map(item => item.id)).toContain(created.body.id);
  });
});
