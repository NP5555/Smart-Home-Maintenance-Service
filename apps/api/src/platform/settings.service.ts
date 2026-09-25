import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../database/redis.module.js';

export const SETTINGS_INVALIDATION_CHANNEL = 'settings:invalidated';
export const SETTINGS_TTL_SECONDS = 300;

export type SettingRow = { key: string; value: Prisma.JsonValue; description: string; updatedAt: Date };

export type SettingsCacheStats = { hits: number; misses: number; invalidations: number };

@Injectable()
export class SettingsService {
  private readonly stats: SettingsCacheStats = { hits: 0, misses: 0, invalidations: 0 };
  private subscribed = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService
  ) {}

  async start(): Promise<void> {
    if (this.subscribed) return;
    await this.redis.subscriber.subscribe(SETTINGS_INVALIDATION_CHANNEL);
    this.redis.subscriber.on('message', (channel: string, key: string) => {
      if (channel !== SETTINGS_INVALIDATION_CHANNEL) return;
      this.stats.invalidations += 1;
      void this.redis.client.del(this.cacheKey(key));
    });
    this.subscribed = true;
  }

  async stop(): Promise<void> {
    if (!this.subscribed) return;
    this.subscribed = false;
    this.redis.subscriber.removeAllListeners('message');
    await this.redis.subscriber.unsubscribe(SETTINGS_INVALIDATION_CHANNEL);
  }

  async list(): Promise<SettingRow[]> {
    return this.prisma.$queryRaw<SettingRow[]>(Prisma.sql`SELECT key, value, description, updated_at as "updatedAt" FROM settings ORDER BY key`);
  }

  async get<T>(key: string): Promise<T | null> {
    const cached = await this.redis.client.get(this.cacheKey(key));
    if (cached !== null) {
      this.stats.hits += 1;
      return JSON.parse(cached) as T;
    }
    this.stats.misses += 1;
    const rows = await this.prisma.$queryRaw<{ value: Prisma.JsonValue }[]>(Prisma.sql`SELECT value FROM settings WHERE key = ${key}`);
    const value = rows[0]?.value ?? null;
    if (value !== null) await this.redis.client.set(this.cacheKey(key), JSON.stringify(value), 'EX', SETTINGS_TTL_SECONDS);
    return value as T | null;
  }

  async require<T>(key: string): Promise<T> {
    const value = await this.get<T>(key);
    if (value === null) throw new Error(`Setting "${key}" is not configured`);
    return value;
  }

  async getNumber(key: string): Promise<number> {
    const value = await this.get<number>(key);
    if (typeof value !== 'number') throw new Error(`Setting "${key}" must be a number`);
    return value;
  }

  async getBoolean(key: string): Promise<boolean> {
    const value = await this.get<boolean>(key);
    if (typeof value !== 'boolean') throw new Error(`Setting "${key}" must be a boolean`);
    return value;
  }

  async set(key: string, value: Prisma.InputJsonValue, actorUserId: string): Promise<SettingRow> {
    const rows = await this.prisma.$transaction(async tx => {
      const previous = await tx.$queryRaw<{ value: Prisma.JsonValue; description: string }[]>(Prisma.sql`SELECT value, description FROM settings WHERE key = ${key} FOR UPDATE`);
      const description = previous[0]?.description ?? key;
      const updated = await tx.$queryRaw<SettingRow[]>(
        Prisma.sql`INSERT INTO settings(key, value, description, updated_by) VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${description}, ${actorUserId}::uuid)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
          RETURNING key, value, description, updated_at as "updatedAt"`
      );
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id, before, after)
          VALUES (${actorUserId}::uuid, 'ADMIN'::actor_role, 'settings.update', 'settings', ${key}, ${JSON.stringify(previous[0]?.value ?? null)}::jsonb, ${JSON.stringify(value)}::jsonb)`
      );
      return updated;
    });
    const row = rows[0];
    if (row === undefined) throw new Error('Settings update did not return a row');
    await this.redis.client.del(this.cacheKey(key));
    await this.redis.publisher.publish(SETTINGS_INVALIDATION_CHANNEL, key);
    return row;
  }

  cacheStats(): SettingsCacheStats {
    return { ...this.stats };
  }

  private cacheKey(key: string): string {
    return `settings:${key}`;
  }
}
