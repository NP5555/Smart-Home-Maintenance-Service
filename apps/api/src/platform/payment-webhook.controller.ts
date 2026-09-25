import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import { Public } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { PrismaService } from '../database/prisma.service.js';
import { PAYMENT_GATEWAY } from '../integrations/integrations.module.js';
import type { ParsedPaymentEvent, PaymentGatewayPort } from '../integrations/ports.js';
import { appendOutboxEvent } from './audit.service.js';

const providerSchema = z.enum(['mock']);
const eventSchema = z.object({ eventId: z.string().min(1).max(200), paymentId: z.string().uuid(), type: z.string().min(1).max(100), occurredAt: z.string().min(1), payload: z.record(z.unknown()) });

export type WebhookIngestResult = {
  accepted: true;
  duplicate: boolean;
  eventId: string;
  /** False when the event names a payment we have no record of. */
  matchedPayment: boolean;
};

@ApiTags('webhooks')
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  @Post(':provider')
  @HttpCode(202)
  @Public()
  @ApiOperation({
    summary: 'Payment provider webhook (not for direct use)',
    description:
      "Called automatically by the payment gateway to report events like a completed or failed payment. The request must carry the gateway's signature to prove it is genuine. If the same event is delivered more than once (gateways commonly retry), later copies are recognized and safely ignored instead of being processed twice."
  })
  async receive(
    @Req() request: FastifyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Param('provider') rawProvider: string
  ): Promise<WebhookIngestResult> {
    const { provider } = parseWith(z.object({ provider: providerSchema }).strict(), { provider: rawProvider });
    const rawBody = (request.rawBody ?? Buffer.from(JSON.stringify(body))).toString('utf8');
    let parsed: ParsedPaymentEvent;
    try {
      parsed = this.gateway.verifyWebhook(headers, rawBody);
    } catch (error) {
      throw new DomainError('UNAUTHENTICATED', error instanceof Error ? error.message : 'Webhook signature verification failed');
    }
    const event = parseWith(eventSchema, parsed);

    const outcome = await this.prisma.$transaction(async tx => {
      // `payment_events.payment_id` is nullable on purpose: a gateway can
      // legitimately deliver an event for a payment this instance has no record
      // of, for example after a restore or a replay from a long-dead queue. The
      // event is still stored so the dedupe key is honoured, and rejecting it
      // would make the gateway retry forever.
      const [payment] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM payments WHERE id = ${event.paymentId}::uuid`);
      const paymentId = payment?.id ?? null;

      // received_at is the server clock, which is authoritative; the gateway's
      // own occurredAt is kept inside the payload rather than trusted.
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO payment_events(gateway, gateway_event_id, payment_id, type, payload)
          VALUES (${provider}, ${event.eventId}, ${paymentId}::uuid, ${event.type}, ${JSON.stringify({ ...event.payload, gatewayOccurredAt: event.occurredAt })}::jsonb)
          ON CONFLICT (gateway, gateway_event_id) DO NOTHING
          RETURNING id`
      );
      if (rows.length === 0) return { inserted: false, matched: paymentId !== null };

      // Only a matched payment has downstream work; an orphan event is recorded
      // for audit and left for reconciliation.
      if (paymentId !== null) {
        await appendOutboxEvent(tx, { aggregate: 'payment', aggregateId: paymentId, type: 'payment.webhook.received', payload: { eventId: event.eventId, type: event.type, paymentId } });
      }
      return { inserted: true, matched: paymentId !== null };
    });

    return { accepted: true, duplicate: !outcome.inserted, eventId: event.eventId, matchedPayment: outcome.matched };
  }
}
