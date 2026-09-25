import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({ controllers: [SettingsController, PaymentWebhookController], providers: [SettingsService, AuditService, OutboxDispatcher], exports: [SettingsService, AuditService, OutboxDispatcher] })
export class PlatformModule {}
