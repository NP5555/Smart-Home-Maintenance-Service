import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.module.js';

@Injectable()
export class SettingsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly channel = 'settings:invalidated';

  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.redis.subscriber.subscribe(this.channel);
    this.redis.subscriber.on('message', (_channel: string, key: string) => {
      void this.redis.client.del(`settings:${key}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.subscriber.unsubscribe(this.channel);
  }

  async list(): Promise<{ key: string; value: Prisma.JsonValue; description: string; updatedAt: Date }[]> {
    return this.prisma.$queryRaw(Prisma.sql`SELECT key, value, description, updated_at as "updatedAt" FROM settings ORDER BY key`);
  }

  async get<T>(key: string): Promise<T | null> {
    const cached = await this.redis.client.get(`settings:${key}`);
    if (cached) return JSON.parse(cached) as T;
    const rows = await this.prisma.$queryRaw<{ value: Prisma.JsonValue }[]>(Prisma.sql`SELECT value FROM settings WHERE key = ${key}`);
    if (!rows[0]) return null;
    await this.redis.client.set(`settings:${key}`, JSON.stringify(rows[0].value), 'EX', 300);
    return rows[0].value as T;
  }

  async set(key: string, value: Prisma.InputJsonValue, actorUserId: string, actorRole: 'ADMIN'): Promise<void> {
    const previous = await this.prisma.$queryRaw<{ value: Prisma.JsonValue }[]>(Prisma.sql`SELECT value FROM settings WHERE key = ${key} FOR UPDATE`);
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`INSERT INTO settings(key, value, description, updated_by) VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${key}, ${actorUserId}::uuid) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id, before, after) VALUES (${actorUserId}::uuid, 'ADMIN', 'settings.update', 'settings', ${key}, ${JSON.stringify(previous[0]?.value ?? null)}::jsonb, ${JSON.stringify(value)}::jsonb)`);
    });
    await this.redis.client.del(`settings:${key}`);
    await this.redis.publisher.publish(this.channel, key);
  }
}
