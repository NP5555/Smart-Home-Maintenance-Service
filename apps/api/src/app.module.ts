import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ACCESS_TOKEN_VERIFIER, UnconfiguredAccessTokenVerifier } from './common/access-token.port.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { IdempotencyService } from './common/idempotency.service.js';
import { PolicyGuard } from './common/policy.guard.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { EnvironmentModule } from './config/environment.module.js';
import { PrismaService } from './database/prisma.service.js';
import { RedisModule } from './database/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { QueueModule } from './queues/queue.registry.js';

@Module({
  imports: [EnvironmentModule, RedisModule, QueueModule, IntegrationsModule, PlatformModule],
  controllers: [HealthController],
  providers: [
    PrismaService,
    IdempotencyService,
    { provide: ACCESS_TOKEN_VERIFIER, useClass: UnconfiguredAccessTokenVerifier },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: PolicyGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }
  ],
  exports: [PrismaService, IdempotencyService]
})
export class AppModule {}
