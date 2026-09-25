import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.module.js';
import { PolicyDecorator } from '../common/policy.js';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Get()
  @PolicyDecorator({ public: true })
  root() {
    return { service: 'smart-home-api', version: 'foundation', docs: '/api/docs' };
  }

  @Get('health/live')
  @PolicyDecorator({ public: true })
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @PolicyDecorator({ public: true })
  async ready() {
    const database = await this.prisma.$queryRaw(Prisma.sql`SELECT 1`).then(() => true).catch(() => false);
    const redis = await this.redis.client.ping().then(value => value === 'PONG').catch(() => false);
    return { status: database && redis ? 'ready' : 'not_ready', checks: { database, redis } };
  }
}
