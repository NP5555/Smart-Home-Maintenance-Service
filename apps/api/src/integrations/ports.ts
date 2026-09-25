export type Paisa = bigint;
export type PaymentCustomer = { id: string; email?: string; phone?: string };
export type PaymentCheckout = { paymentId: string; amount: Paisa; customer: PaymentCustomer; returnUrl: string; idempotencyKey: string };
export type ParsedPaymentEvent = { eventId: string; paymentId: string; type: string; occurredAt: string; payload: PrismaJson };
type PrismaJson = null | boolean | number | string | PrismaJson[] | { [key: string]: PrismaJson };

export interface PaymentGateway {
  createCheckout(input: PaymentCheckout): Promise<{ redirectUrl: string; providerRef: string }>;
  refund(input: { providerRef: string; amount: Paisa; reason: string; idempotencyKey: string }): Promise<{ refundRef: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' }>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): ParsedPaymentEvent;
}

export interface SmsSender { send(to: string, body: string, meta?: Record<string, string>): Promise<{ providerMessageId: string }> }
export interface EmailSender { send(to: string, subject: string, body: string, meta?: Record<string, string>): Promise<{ providerMessageId: string }> }
export interface Geocoder { geocode(address: string, cityHint?: string): Promise<{ lat: number; lng: number; confidence: number }> }
export interface Telephony { bridgeCall(input: { agentEndpoint: string; customerPhone: string; record: boolean }): Promise<{ callRef: string; status: 'QUEUED' }> }
export interface WhatsAppSender { send(to: string, body: string, meta?: Record<string, string>): Promise<{ providerMessageId: string }> }
export interface ObjectStorage {
  presignPut(key: string, contentType: string, maxBytes: number): Promise<{ url: string; method: 'PUT' }>;
  presignGet(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: string }>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
