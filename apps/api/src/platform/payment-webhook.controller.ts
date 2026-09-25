import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../database/prisma.service.js';
import { MockPaymentGateway } from '../integrations/mocks.js';
import { PolicyDecorator } from '../common/policy.js';
import { DomainError } from '../common/domain-error.js';

type SignedRequest = FastifyRequest & { rawBody?: Buffer };

@ApiTags('webhooks')
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly gateway: MockPaymentGateway, private readonly prisma: PrismaService) {}

  @Post(':provider')
  @HttpCode(202)
  @PolicyDecorator({ public: true })
  async receive(@Req() request: SignedRequest, @Headers() headers: Record<string, string | string[] | undefined>, @Body() body: unknown) {
    let event: ReturnType<MockPaymentGateway['verifyWebhook']>;
    try {
      event = this.gateway.verifyWebhook(headers, (request.rawBody ?? Buffer.from(JSON.stringify(body))).toString('utf8'));
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Webhook signature is invalid');
    }
    const inserted = await this.prisma.$executeRaw(Prisma.sql`INSERT INTO payment_events(gateway, gateway_event_id, payment_id, type, payload) VALUES ('mock', ${event.eventId}, ${event.paymentId}::uuid, ${event.type}, ${JSON.stringify(event.payload)}::jsonb) ON CONFLICT (gateway, gateway_event_id) DO NOTHING`);
    return { accepted: true, duplicate: inserted === 0 };
  }
}
