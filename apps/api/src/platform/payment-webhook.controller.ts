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

export type WebhookIngestResult = { accepted: true; duplicate: boolean; eventId: string };

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
  @ApiOperation({ summary: 'Signed gateway webhook; deduplicated by (gateway, gateway_event_id)' })
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
    const inserted = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: bigint }[]>(
        Prisma.sql`INSERT INTO payment_events(gateway, gateway_event_id, payment_id, type, payload, occurred_at)
          VALUES (${provider}, ${event.eventId}, ${event.paymentId}::uuid, ${event.type}, ${JSON.stringify(event.payload)}::jsonb, ${event.occurredAt}::timestamptz)
          ON CONFLICT (gateway, gateway_event_id) DO NOTHING
          RETURNING id`
      );
      if (rows.length === 0) return false;
      await appendOutboxEvent(tx, { aggregate: 'payment', aggregateId: event.paymentId, type: 'payment.webhook.received', payload: { eventId: event.eventId, type: event.type, paymentId: event.paymentId } });
      return true;
    });
    return { accepted: true, duplicate: !inserted, eventId: event.eventId };
  }
}
