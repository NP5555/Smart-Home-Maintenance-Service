import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EnvironmentModule } from './config/environment.module.js';
import { PrismaService } from './database/prisma.service.js';
import { RedisModule } from './database/redis.module.js';
import { QueueModule } from './queues/queue.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { HealthController } from './health/health.controller.js';
import { PolicyGuard } from './common/policy.guard.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';

@Module({
  imports: [EnvironmentModule, RedisModule, QueueModule, IntegrationsModule, PlatformModule, IdentityModule],
  controllers: [HealthController],
  providers: [PrismaService, { provide: APP_FILTER, useClass: ProblemDetailsFilter }, { provide: APP_GUARD, useClass: PolicyGuard }, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply().forRoutes('*');
  }
}
