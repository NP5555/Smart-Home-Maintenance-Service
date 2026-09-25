import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { EnvironmentService } from '../config/environment.js';
import type { EmailSender, Geocoder, ObjectStorage, PaymentGateway, SmsSender, Telephony, WhatsAppSender } from './ports.js';

export type InboxItem = { id: string; channel: 'SMS' | 'EMAIL' | 'WHATSAPP'; recipient: string; subject?: string; body: string; createdAt: string; metadata: Record<string, string> };

@Injectable()
export class MockInbox {
  private readonly items: InboxItem[] = [];

  add(item: Omit<InboxItem, 'id' | 'createdAt'>): InboxItem {
    const value = { ...item, id: randomUUID(), createdAt: new Date().toISOString() };
    this.items.push(value);
    return value;
  }

  list(): InboxItem[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }
}

@Injectable()
export class MockSms implements SmsSender {
  constructor(private readonly inbox: MockInbox) {}
  async send(to: string, body: string, meta: Record<string, string> = {}): Promise<{ providerMessageId: string }> {
    const item = this.inbox.add({ channel: 'SMS', recipient: to, body, metadata: meta });
    return { providerMessageId: item.id };
  }
}

@Injectable()
export class MockEmail implements EmailSender {
  constructor(private readonly inbox: MockInbox) {}
  async send(to: string, subject: string, body: string, meta: Record<string, string> = {}): Promise<{ providerMessageId: string }> {
    const item = this.inbox.add({ channel: 'EMAIL', recipient: to, subject, body, metadata: meta });
    return { providerMessageId: item.id };
  }
}

@Injectable()
export class MockWhatsApp implements WhatsAppSender {
  constructor(private readonly inbox: MockInbox) {}
  async send(to: string, body: string, meta: Record<string, string> = {}): Promise<{ providerMessageId: string }> {
    const item = this.inbox.add({ channel: 'WHATSAPP', recipient: to, body, metadata: meta });
    return { providerMessageId: item.id };
  }
}

@Injectable()
export class MockGeocoder implements Geocoder {
  async geocode(address: string): Promise<{ lat: number; lng: number; confidence: number }> {
    let hash = 0;
    for (const character of address) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return { lat: 31.4 + (Math.abs(hash) % 1_000) / 100_000, lng: 74.2 + (Math.abs(hash) % 1_000) / 100_000, confidence: 0.95 };
  }
}

@Injectable()
export class MockTelephony implements Telephony {
  async bridgeCall(input: { agentEndpoint: string; customerPhone: string; record: boolean }): Promise<{ callRef: string; status: 'QUEUED' }> {
    if (!input.agentEndpoint || !input.customerPhone) throw new Error('Missing telephony input');
    return { callRef: randomUUID(), status: 'QUEUED' };
  }
}

@Injectable()
export class MockStorage implements ObjectStorage {
  private readonly objects = new Map<string, { content: Uint8Array; contentType: string }>();

  async put(key: string, content: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { content, contentType });
  }

  async presignPut(key: string, contentType: string, maxBytes: number): Promise<{ url: string; method: 'PUT' }> {
    if (!contentType || maxBytes < 1) throw new Error('Invalid upload policy');
    return { url: `/api/v1/dev/storage/${encodeURIComponent(key)}?contentType=${encodeURIComponent(contentType)}&maxBytes=${maxBytes}`, method: 'PUT' };
  }

  async presignGet(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: string }> {
    if (!this.objects.has(key)) throw new Error('Object not found');
    return { url: `/api/v1/dev/storage/${encodeURIComponent(key)}`, expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString() };
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const object = this.objects.get(key);
    return object ? { size: object.content.byteLength, contentType: object.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  read(key: string): { content: Uint8Array; contentType: string } | null {
    return this.objects.get(key) ?? null;
  }
}

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  constructor(private readonly environment: EnvironmentService) {}

  async createCheckout(input: { paymentId: string; amount: bigint; returnUrl: string; idempotencyKey: string }): Promise<{ redirectUrl: string; providerRef: string }> {
    if (input.amount <= 0n) throw new Error('Payment amount must be positive');
    return { providerRef: randomUUID(), redirectUrl: `/api/v1/dev/payments/${input.paymentId}?returnUrl=${encodeURIComponent(input.returnUrl)}` };
  }

  async refund(): Promise<{ refundRef: string; status: 'SUCCEEDED' }> {
    return { refundRef: randomUUID(), status: 'SUCCEEDED' };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): ReturnType<PaymentGateway['verifyWebhook']> {
    const signature = headers['x-mock-signature'];
    const timestamp = headers['x-mock-timestamp'];
    if (typeof signature !== 'string' || typeof timestamp !== 'string') throw new Error('Missing webhook signature');
    const age = Math.abs(Date.now() - Number(timestamp));
    if (!Number.isFinite(age) || age > 300_000) throw new Error('Expired webhook timestamp');
    const expected = createHmac('sha256', this.environment.values.MOCK_PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
    const actualBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new Error('Invalid webhook signature');
    return JSON.parse(rawBody) as ReturnType<PaymentGateway['verifyWebhook']>;
  }
}

export const createMockSignature = (secret: string, timestamp: number, body: string): string => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
