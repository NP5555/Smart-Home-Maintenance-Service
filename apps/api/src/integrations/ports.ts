import type { Paisa } from '@smart-home/contracts';

export type PaymentCustomer = { userId: string; email?: string | undefined; phone?: string | undefined };

export type PaymentCheckoutInput = { paymentId: string; amount: Paisa; currency: 'PKR'; customer: PaymentCustomer; returnUrl: string; idempotencyKey: string };
export type PaymentCheckoutResult = { providerRef: string; redirectUrl: string };
export type RefundResult = { refundRef: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' };

export type ParsedPaymentEvent = { eventId: string; paymentId: string; type: string; occurredAt: string; payload: Record<string, unknown> };

export interface PaymentGatewayPort {
  createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult>;
  refund(input: { providerRef: string; amount: Paisa; reason: string; idempotencyKey: string }): Promise<RefundResult>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): ParsedPaymentEvent;
}

export interface SmsSenderPort {
  send(to: string, body: string, meta?: Record<string, string>): Promise<{ providerMessageId: string }>;
}

export interface EmailSenderPort {
  send(to: string, subject: string, body: string, meta?: Record<string, string>): Promise<{ providerMessageId: string }>;
}

export interface WhatsAppSenderPort {
  send(to: string, body: string, meta?: Record<string, string>): Promise<{ providerMessageId: string }>;
}

export interface GeocoderPort {
  geocode(address: string, cityHint?: string): Promise<{ lat: number; lng: number; confidence: number }>;
}

export interface TelephonyPort {
  bridgeCall(input: { agentEndpoint: string; customerPhone: string; record: boolean }): Promise<{ callRef: string; status: 'QUEUED' }>;
}

export interface ObjectStoragePort {
  presignPut(input: { key: string; bucket: string; contentType: string; maxBytes: number }): Promise<{ url: string; method: 'PUT'; expiresAt: string }>;
  presignGet(input: { key: string; bucket: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: string }>;
  head(input: { key: string; bucket: string }): Promise<{ size: number; contentType: string } | null>;
  remove(input: { key: string; bucket: string }): Promise<void>;
}
