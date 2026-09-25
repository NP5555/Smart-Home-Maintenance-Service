import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import { Public } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { EnvironmentService } from '../config/environment.service.js';
import { DevInbox, MockObjectStorage, STORAGE_BUCKETS } from './mocks.js';

const bucketSchema = z.enum(STORAGE_BUCKETS);
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();

@ApiTags('development')
@Controller('dev')
export class DevController {
  constructor(
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(DevInbox) private readonly inbox: DevInbox,
    @Inject(MockObjectStorage) private readonly storage: MockObjectStorage
  ) {}

  @Get('inbox')
  @Public()
  @ApiOperation({
    summary: 'View messages the mock SMS/email/WhatsApp senders "sent"',
    description: 'Development-only: since no real SMS/email/WhatsApp provider is configured, messages that would normally be delivered are captured here instead — including OTP codes — so you can complete a signup or login flow while testing locally. Disabled when DEV_INBOX_ENABLED is false.'
  })
  inboxMessages(@Query() query: unknown) {
    this.assertEnabled();
    const { limit } = parseWith(listQuerySchema, query);
    return { items: this.inbox.list(limit) };
  }

  @Get('storage/:bucket/:key')
  @Public()
  @ApiOperation({
    summary: 'Download a file from the mock file storage',
    description: "Development-only: retrieves a file that was 'uploaded' to the mock storage adapter, which stands in for a real object store (like S3 or MinIO) in this environment."
  })
  storageObject(@Param('bucket') bucket: string, @Param('key') key: string) {
    this.assertEnabled();
    const parsedBucket = parseWith(bucketSchema, bucket);
    const object = this.storage.read(parsedBucket, decodeURIComponent(key));
    if (object === null) throw new DomainError('NOT_FOUND', 'The object does not exist in the mock storage adapter');
    return { bucket: parsedBucket, key: decodeURIComponent(key), contentType: object.contentType, sizeBytes: object.content.byteLength, contentBase64: Buffer.from(object.content).toString('base64') };
  }

  private assertEnabled(): void {
    if (!this.environment.values.DEV_INBOX_ENABLED) throw new DomainError('FORBIDDEN', 'Development endpoints are disabled in this environment');
  }
}
