import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EnvironmentService } from '../config/environment.js';
import { MockInbox, MockStorage } from '../integrations/mocks.js';
import { PolicyDecorator } from '../common/policy.js';

@ApiTags('development')
@Controller('dev')
export class DevController {
  constructor(private readonly environment: EnvironmentService, private readonly inbox: MockInbox, private readonly storage: MockStorage) {}

  @Get('inbox')
  @PolicyDecorator({ public: true })
  inboxItems() {
    this.assertEnabled();
    return this.inbox.list();
  }

  @Get('storage/:key')
  @PolicyDecorator({ public: true })
  storageObject(key: string) {
    this.assertEnabled();
    const object = this.storage.read(decodeURIComponent(key));
    return object ? { content: Buffer.from(object.content).toString('base64'), contentType: object.contentType } : { content: null };
  }

  private assertEnabled(): void {
    if (!this.environment.values.DEV_INBOX_ENABLED) throw new Error('Development endpoints are disabled');
  }
}
