import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { EnvironmentService } from '../config/environment.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.module.js';
import { QueueRegistry, type QueueName } from '../queues/queue.registry.js';
import { SettingsService } from '../platform/settings.service.js';
import { OBJECT_STORAGE } from '../integrations/integrations.module.js';
import type { ObjectStoragePort } from '../integrations/ports.js';
import { Inject } from '@nestjs/common';

export type HealthState = 'ok' | 'degraded' | 'down';

export type HealthCheckResult = { name: string; status: HealthState; detail?: string; durationMs: number };

export type ReadinessReport = { status: HealthState; checks: HealthCheckResult[]; checkedAt: string };

export const probe = async (name: string, check: () => Promise<string | null>): Promise<HealthCheckResult> => {
  const startedAt = process.hrtime.bigint();
  try {
    const detail = await check();
    return { name, status: 'ok', ...(detail === null ? {} : { detail }), durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000 };
  } catch (error) {
    return { name, status: 'down', detail: error instanceof Error ? error.message : 'unknown failure', durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000 };
  }
};

const worst = (checks: HealthCheckResult[]): HealthState => (checks.some(check => check.status === 'down') ? 'down' : checks.some(check => check.status === 'degraded') ? 'degraded' : 'ok');

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Service banner' })
  root() {
    return { service: 'smart-home-maintenance-service', api: 'api/v1', docs: '/api/docs', health: '/health/ready', environment: this.environment.values.NODE_ENV };
  }

  @Get('health/live')
  @Public()
  @ApiOperation({ summary: 'Liveness probe: the process is running' })
  live() {
    return { status: 'ok', pid: process.pid, uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('health/ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe: database, redis, queues, settings and storage' })
  @ApiResponse({ status: 200, description: 'Every dependency answered' })
  @ApiResponse({ status: 503, description: 'At least one dependency is down' })
  async ready(): Promise<ReadinessReport> {
    const checks = await Promise.all([
      probe('database', async () => {
        if (!(await this.prisma.ping())) throw new Error('database ping failed');
        return 'postgresql';
      }),
      probe('redis', async () => {
        const ready = await this.redis.ping();
        if (!ready) throw new Error('redis ping failed');
        return 'redis';
      }),
      probe('queues', async () => {
        const depths = await this.queues.depths();
        const unreachable = Object.entries(depths).filter(([, depth]) => depth < 0);
        if (unreachable.length > 0) throw new Error(`unreachable queues: ${unreachable.map(([name]) => name).join(', ')}`);
        return Object.entries(depths)
          .map(([name, depth]) => `${name}=${depth}`)
          .join(' ');
      }),
      probe('settings', async () => {
        const value = await this.settings.get<number>('verification.sla_min');
        if (value === null) throw new Error('settings table has no verification.sla_min row');
        return `verification.sla_min=${value}`;
      }),
      probe('storage', async () => {
        const bucket = this.environment.storageBuckets[0];
        if (bucket === undefined) throw new Error('no storage bucket is configured');
        await this.storage.head({ key: '.healthcheck', bucket });
        return `bucket=${bucket}`;
      })
    ]);
    return { status: worst(checks), checks, checkedAt: new Date().toISOString() };
  }

  @Get('health/queues')
  @Public()
  @ApiOperation({ summary: 'BullMQ depth per registered queue' })
  async queueDepths(): Promise<Record<QueueName, number>> {
    return this.queues.depths();
  }
}
