import { execute, literal } from './support.js';

type TemplateSeed = { eventKey: string; channel: 'SMS' | 'EMAIL' | 'IN_APP' | 'WHATSAPP'; subject: string | null; bodyEn: string; bodyUr: string };

const t = (eventKey: string, channel: TemplateSeed['channel'], subject: string | null, bodyEn: string, bodyUr: string): TemplateSeed => ({ eventKey, channel, subject, bodyEn, bodyUr });

export const notificationTemplates: readonly TemplateSeed[] = [
  t('auth.otp', 'SMS', null, 'Your Smart Home verification code is {{code}}. It expires in 10 minutes.', 'آپ کا سمارٹ ہوم کوڈ {{code}} ہے۔ یہ 10 منٹ میں ختم ہو جائے گا۔'),
  t('auth.password_reset', 'SMS', null, 'Use code {{code}} to reset your Smart Home password.', 'پاس ورڈ ری سیٹ کرنے کے لیے کوڈ {{code}} استعمال کریں۔'),
  t('booking.requested', 'IN_APP', 'Booking request received', 'We are finding a {{serviceName}} professional near you.', 'ہم آپ کے قریب {{serviceName}} کا پیشہ کار تلاش کر رہے ہیں۔'),
  t('booking.offer', 'SMS', null, 'A {{serviceName}} job is available near you on {{slotLabel}}. Open the app to accept.', '{{slotLabel}} پر {{serviceName}} کا کام دستیاب ہے۔ قبول کرنے کے لیے ایپ کھولیں۔'),
  t('booking.accepted', 'IN_APP', 'Provider assigned', '{{providerName}} is assigned to your booking.', '{{providerName}} آپ کے بکنگ کے لیے منتخب ہو گیا ہے۔'),
  t('booking.scheduled', 'SMS', null, 'Your visit is confirmed for {{slotLabel}}. Your start code is {{otp}}.', 'آپ کا وزٹ {{slotLabel}} کو confirm ہے۔ آپ کا کوڈ {{otp}} ہے۔'),
  t('booking.reminder_24h', 'SMS', null, 'Reminder: your {{serviceName}} visit is tomorrow at {{slotLabel}}.', 'یاد دہانی: آپ کا {{serviceName}} وزٹ کل {{slotLabel}} کو ہے۔'),
  t('booking.reminder_2h', 'SMS', null, 'Your {{serviceName}} professional arrives in about 2 hours.', 'آپ کے {{serviceName}} پیشہ کار تقریباً 2 گھنٹے میں پہنچیں گے۔'),
  t('booking.cancelled', 'IN_APP', 'Booking cancelled', 'Your booking {{bookingRef}} was cancelled. Any paid amount is being refunded.', 'آپ کا بکنگ {{bookingRef}} منسوخ ہو گیا۔ ادا شدہ رقم واپس کی جا رہی ہے۔'),
  t('booking.on_the_way', 'IN_APP', 'Provider on the way', '{{providerName}} has left for your address.', '{{providerName}} آپ کے پتے کے لیے روانہ ہو گیا ہے۔'),
  t('booking.quote_revision', 'IN_APP', 'Revised quote awaiting approval', '{{providerName}} submitted a revised total of {{total}}. Please approve or reject.', '{{providerName}} نے نیا رقم {{total}} بھیجا ہے۔ منظور یا مسترد کریں۔'),
  t('booking.awaiting_verification', 'IN_APP', 'Work completed', 'Your job is complete and payment is being verified.', 'آپ کا کام مکمل ہے اور ادائیگی کی تصدیق جاری ہے۔'),
  t('booking.no_show_reported', 'IN_APP', 'No-show reported', 'A no-show was recorded for booking {{bookingRef}}.', 'بکنگ {{bookingRef}} کے لیے حاضری نہیں کی گئی۔'),
  t('verification.link', 'SMS', null, 'Confirm your booking {{bookingRef}} at {{link}} using code {{otp}}.', 'کوڈ {{otp}} استعمال کر کے {{link}} پر بکنگ {{bookingRef}} کی تصدیق کریں۔'),
  t('payment.released', 'IN_APP', 'Payment released', '{{amount}} has been released to your provider.', '{{amount}} آپ کے پیشہ کار کو جاری کر دی گئی ہے۔'),
  t('payment.receipt', 'SMS', null, 'Receipt for {{amount}} on booking {{bookingRef}}. Report a problem: {{problemLink}}', 'بکنگ {{bookingRef}} پر {{amount}} کی رسید۔ مسئلہ رپورٹ کریں: {{problemLink}}'),
  t('payment.refunded', 'IN_APP', 'Refund processed', '{{amount}} was refunded to your original payment method.', '{{amount}} آپ کے ادائیگی طریقے پر واپس کر دی گئی ہے۔'),
  t('complaint.received', 'IN_APP', 'Complaint received', 'We received your complaint about booking {{bookingRef}} and will respond within the stated time.', 'ہمیں آپ کی شکایت مل گئی ہے اور ہم مقررہ وقت میں جواب دیں گے۔'),
  t('penalty.proposed', 'IN_APP', 'Penalty proposed', 'A breach was recorded against your account. You have 48 hours to reply.', 'آپ کے اکاؤنٹ پر جرم درج ہوا ہے۔ جواب دینے کے لیے 48 گھنٹے ہیں۔'),
  t('payout.paid', 'IN_APP', 'Payout paid', '{{amount}} was paid to your bank account.', '{{amount}} آپ کے بینک اکاؤنٹ میں جمع کر دی گئی۔')
];

export const seedNotificationTemplates = async (): Promise<void> => {
  for (const template of notificationTemplates) {
    for (const [locale, body] of [
      ['en', template.bodyEn],
      ['ur', template.bodyUr]
    ] as const) {
      await execute(
        `INSERT INTO notification_templates(event_key, channel, locale, subject, body)
         VALUES (${literal(template.eventKey)}, ${literal(template.channel)}::notification_channel, ${literal(locale)},
           ${template.subject === null ? 'NULL' : literal(template.subject)}, ${literal(body)})
         ON CONFLICT (event_key, channel, locale) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body`
      );
    }
  }
};
