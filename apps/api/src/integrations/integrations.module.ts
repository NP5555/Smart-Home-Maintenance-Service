import { Global, Module } from '@nestjs/common';
import { MockEmail, MockGeocoder, MockInbox, MockPaymentGateway, MockSms, MockStorage, MockTelephony, MockWhatsApp } from './mocks.js';
import { DevController } from './dev.controller.js';
import type { EmailSender, Geocoder, ObjectStorage, PaymentGateway, SmsSender, Telephony, WhatsAppSender } from './ports.js';

@Global()
@Module({
  controllers: [DevController],
  providers: [
    MockInbox, MockSms, MockEmail, MockWhatsApp, MockGeocoder, MockTelephony, MockStorage, MockPaymentGateway,
    { provide: 'PAYMENT_GATEWAY', useExisting: MockPaymentGateway },
    { provide: 'SMS_SENDER', useExisting: MockSms },
    { provide: 'EMAIL_SENDER', useExisting: MockEmail },
    { provide: 'WHATSAPP_SENDER', useExisting: MockWhatsApp },
    { provide: 'GEOCODER', useExisting: MockGeocoder },
    { provide: 'TELEPHONY', useExisting: MockTelephony },
    { provide: 'OBJECT_STORAGE', useExisting: MockStorage }
  ],
  exports: [MockInbox, 'PAYMENT_GATEWAY', 'SMS_SENDER', 'EMAIL_SENDER', 'WHATSAPP_SENDER', 'GEOCODER', 'TELEPHONY', 'OBJECT_STORAGE']
})
export class IntegrationsModule {}

export type IntegrationPorts = {
  payment: PaymentGateway;
  sms: SmsSender;
  email: EmailSender;
  whatsapp: WhatsAppSender;
  maps: Geocoder;
  telephony: Telephony;
  storage: ObjectStorage;
};
