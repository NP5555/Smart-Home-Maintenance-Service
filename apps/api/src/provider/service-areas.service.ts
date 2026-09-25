import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';

export type ServiceAreaRow = { areaId: number };

@Injectable()
export class ServiceAreasService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listMine(providerId: string): Promise<ServiceAreaRow[]> {
    return this.prisma.$queryRaw<ServiceAreaRow[]>(Prisma.sql`SELECT area_id as "areaId" FROM provider_service_areas WHERE provider_id = ${providerId}::uuid ORDER BY area_id`);
  }

  async replaceMine(providerId: string, areaIds: number[]): Promise<ServiceAreaRow[]> {
    if (areaIds.length > 0) {
      const found = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM areas WHERE id IN (${Prisma.join(areaIds)}) AND is_active = true`);
      const missing = areaIds.filter(id => !found.some(row => row.id === id));
      if (missing.length > 0) throw notFound(`Area${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
    }
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM provider_service_areas WHERE provider_id = ${providerId}::uuid`);
      if (areaIds.length === 0) return [];
      const values = Prisma.join(areaIds.map(areaId => Prisma.sql`(${providerId}::uuid, ${areaId})`));
      return tx.$queryRaw<ServiceAreaRow[]>(Prisma.sql`INSERT INTO provider_service_areas(provider_id, area_id) VALUES ${values} RETURNING area_id as "areaId"`);
    });
  }
}
