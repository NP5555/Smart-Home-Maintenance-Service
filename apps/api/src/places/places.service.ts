import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';

export type CityRow = { id: number; name: string; timezone: string };
export type AreaRow = { id: number; cityId: number; name: string };

@Injectable()
export class PlacesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listActiveCities(): Promise<CityRow[]> {
    return this.prisma.$queryRaw<CityRow[]>(Prisma.sql`SELECT id, name, timezone FROM cities WHERE is_active = true ORDER BY name`);
  }

  async listActiveAreas(cityId: number): Promise<AreaRow[]> {
    const cities = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM cities WHERE id = ${cityId} AND is_active = true`);
    if (cities.length === 0) throw notFound('City');
    return this.prisma.$queryRaw<AreaRow[]>(Prisma.sql`SELECT id, city_id as "cityId", name FROM areas WHERE city_id = ${cityId} AND is_active = true ORDER BY name`);
  }
}
