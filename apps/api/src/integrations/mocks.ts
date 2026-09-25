import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { EnvironmentService } from '../config/environment.service.js';
import type {
  EmailSenderPort,
  GeocoderPort,
  ObjectStoragePort,
  ParsedPaymentEvent,
  PaymentCheckoutInput,
  PaymentCheckoutResult,
  PaymentGatewayPort,
  RefundResult,
  SmsSenderPort,
  TelephonyPort,
  WhatsAppSenderPort
} from './ports.js';

export const STORAGE_BUCKETS = ['evidence', 'documents', 'recordings', 'reports'] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export const WEBHOOK_TOLERANCE_MS = 300_000;

export type InboxMessage = {
  id: string;
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
  recipient: string;
  subject?: string;
  body: string;
  createdAt: string;
  metadata: Record<string, string>;
};

@Injectable()
export class DevInbox {
  private readonly messages: InboxMessage[] = [];

  add(message: Omit<InboxMessage, 'id' | 'createdAt'>): InboxMessage {
    const stored: InboxMessage = { ...message, id: randomUUID(), createdAt: new Date().toISOString() };
    this.messages.push(stored);
    return stored;
  }

  list(limit = 50): InboxMessage[] {
    return this.messages.slice(-limit).reverse();
  }

  clear(): void {
    this.messages.length = 0;
  }
}

@Injectable()
export class MockSmsSender implements SmsSenderPort {
  constructor(private readonly inbox: DevInbox) {}

  async send(to: string, body: string, meta: Record<string, string> = {}): Promise<{ providerMessageId: string }> {
    if (!/^\+[1-9]\d{7,14}$/.test(to)) throw new Error('SMS recipient must be E.164');
    return { providerMessageId: this.inbox.add({ channel: 'SMS', recipient: to, body, metadata: meta }).id };
  }
}

@Injectable()
export class MockEmailSender implements EmailSenderPort {
  constructor(private readonly inbox: DevInbox) {}

  async send(to: string, subject: string, body: string, meta: Record<string, string> = {}): Promise<{ providerMessageId: string }> {
    if (!to.includes('@')) throw new Error('Email recipient must be an address');
    return { providerMessageId: this.inbox.add({ channel: 'EMAIL', recipient: to, subject, body, metadata: meta }).id };
  }
}

@Injectable()
export class MockWhatsAppSender implements WhatsAppSenderPort {
  constructor(private readonly inbox: DevInbox) {}

  async send(to: string, body: string, meta: Record<string, string> = {}): Promise<{ providerMessageId: string }> {
    return { providerMessageId: this.inbox.add({ channel: 'WHATSAPP', recipient: to, body, metadata: meta }).id };
  }
}

const stableHash = (value: string): number => {
  const digest = createHash('sha256').update(value).digest();
  return digest.readUInt32BE(0);
};

@Injectable()
export class MockGeocoder implements GeocoderPort {
  async geocode(address: string): Promise<{ lat: number; lng: number; confidence: number }> {
    const seed = stableHash(address.trim().toLowerCase());
    return { lat: 31.3 + (seed % 5_000) / 100_000, lng: 74.2 + ((seed >>> 8) % 5_000) / 100_000, confidence: 0.9 };
  }
}

@Injectable()
export class MockTelephony implements TelephonyPort {
  async bridgeCall(input: { agentEndpoint: string; customerPhone: string; record: boolean }): Promise<{ callRef: string; status: 'QUEUED' }> {
    if (input.agentEndpoint.length === 0 || input.customerPhone.length === 0) throw new Error('Telephony requires an agent endpoint and a customer number');
    return { callRef: randomUUID(), status: 'QUEUED' };
  }
}

@Injectable()
export class MockObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, { content: Uint8Array; contentType: string }>();

  private index(key: string, bucket: string): string {
    return `${bucket}/${key}`;
  }

  async put(key: string, bucket: string, content: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(this.index(key, bucket), { content, contentType });
  }

  async presignPut(input: { key: string; bucket: string; contentType: string; maxBytes: number }): Promise<{ url: string; method: 'PUT'; expiresAt: string }> {
    if (input.maxBytes < 1 || input.contentType.length === 0) throw new Error('Upload policy is invalid');
    return { url: `/api/v1/dev/storage/${input.bucket}/${encodeURIComponent(input.key)}?contentType=${encodeURIComponent(input.contentType)}&maxBytes=${input.maxBytes}`, method: 'PUT', expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }

  async presignGet(input: { key: string; bucket: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: string }> {
    if (input.ttlSeconds < 1 || input.ttlSeconds > 900) throw new Error('Signed download TTL must be between 1 and 900 seconds');
    if (!this.objects.has(this.index(input.key, input.bucket))) throw new Error('Object not found');
    return { url: `/api/v1/dev/storage/${input.bucket}/${encodeURIComponent(input.key)}`, expiresAt: new Date(Date.now() + input.ttlSeconds * 1_000).toISOString() };
  }

  async head(input: { key: string; bucket: string }): Promise<{ size: number; contentType: string } | null> {
    const object = this.objects.get(this.index(input.key, input.bucket));
    return object === undefined ? null : { size: object.content.byteLength, contentType: object.contentType };
  }

  async remove(input: { key: string; bucket: string }): Promise<void> {
    this.objects.delete(this.index(input.key, input.bucket));
  }

  read(bucket: string, key: string): { content: Uint8Array; contentType: string } | null {
    return this.objects.get(this.index(key, bucket)) ?? null;
  }
}

export const signMockWebhook = (secret: string, timestamp: number, body: string): string => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

@Injectable()
export class MockPaymentGateway implements PaymentGatewayPort {
  constructor(private readonly environment: EnvironmentService) {}

  async createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult> {
    if (input.amount <= 0n) throw new Error('Payment amount must be positive');
    if (input.currency !== 'PKR') throw new Error('Only PKR is supported');
    return { providerRef: randomUUID(), redirectUrl: `/api/v1/dev/payments/${input.paymentId}?returnUrl=${encodeURIComponent(input.returnUrl)}` };
  }

  async refund(input: { providerRef: string; amount: bigint; reason: string; idempotencyKey: string }): Promise<RefundResult> {
    if (input.amount <= 0n) throw new Error('Refund amount must be positive');
    return { refundRef: randomUUID(), status: 'SUCCEEDED' };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): ParsedPaymentEvent {
    const signature = headers['x-mock-signature'];
    const timestamp = headers['x-mock-timestamp'];
    if (typeof signature !== 'string' || typeof timestamp !== 'string') throw new Error('Missing webhook signature headers');
    const issuedAt = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > WEBHOOK_TOLERANCE_MS) throw new Error('Webhook timestamp is outside the tolerance window');
    const expected = Buffer.from(signMockWebhook(this.environment.values.MOCK_PAYMENT_WEBHOOK_SECRET, issuedAt, rawBody), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Webhook signature does not match');
    const parsed = JSON.parse(rawBody) as ParsedPaymentEvent;
    if (typeof parsed.eventId !== 'string' || typeof parsed.paymentId !== 'string' || typeof parsed.type !== 'string') throw new Error('Webhook payload is malformed');
    return parsed;
  }
}
