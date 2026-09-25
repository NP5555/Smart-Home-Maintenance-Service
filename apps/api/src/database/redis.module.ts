import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { EnvironmentService } from '../config/environment.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  readonly publisher: Redis;
  readonly subscriber: Redis;

  constructor(environment: EnvironmentService) {
    this.client = new Redis(environment.values.REDIS_URL, { maxRetriesPerRequest: null });
    this.publisher = this.client.duplicate();
    this.subscriber = this.client.duplicate();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.client.quit(), this.publisher.quit(), this.subscriber.quit()]);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
