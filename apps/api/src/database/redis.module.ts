import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { EnvironmentService } from '../config/environment.service.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  readonly publisher: Redis;
  readonly subscriber: Redis;

  constructor(environment: EnvironmentService) {
    const options = { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false };
    this.client = new Redis(environment.values.REDIS_URL, options);
    this.publisher = new Redis(environment.values.REDIS_URL, options);
    this.subscriber = new Redis(environment.values.REDIS_URL, options);
  }

  duplicate(): Redis {
    return this.client.duplicate();
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.publisher.quit(), this.subscriber.quit()]);
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService]
})
export class RedisModule {}
