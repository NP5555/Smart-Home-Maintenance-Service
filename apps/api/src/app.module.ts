import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { IdempotencyModule } from './common/idempotency.service.js';
import { PolicyGuard } from './common/policy.guard.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { BookingModule } from './booking/booking.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { EnvironmentModule } from './config/environment.module.js';
import { PrismaModule } from './database/prisma.service.js';
import { RedisModule } from './database/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PlacesModule } from './places/places.module.js';
import { ProviderModule } from './provider/provider.module.js';
import { QueueModule } from './queues/queue.registry.js';
import { SearchModule } from './search/search.module.js';

@Module({
  imports: [EnvironmentModule, PrismaModule, RedisModule, QueueModule, IntegrationsModule, PlatformModule, IdempotencyModule, IdentityModule, CatalogueModule, PlacesModule, CustomerModule, ProviderModule, SearchModule, BookingModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: PolicyGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }
  ]
})
export class AppModule {}
