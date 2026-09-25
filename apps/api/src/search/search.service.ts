import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ProviderSearchQuery } from './search.schemas.js';

export type ProviderSearchResultRow = { providerId: string; bio: string | null; experienceYears: number | null; qualification: string | null; pricePaisa: number; distanceM: number };

type ProviderSearchResultRowRaw = Omit<ProviderSearchResultRow, 'pricePaisa'> & { pricePaisa: bigint };

export type ProviderDetailRow = {
  providerId: string;
  status: string;
  bio: string | null;
  experienceYears: number | null;
  qualification: string | null;
  cityId: number | null;
  radiusM: number;
};

export type ProviderDetailServiceRow = { serviceId: number; slug: string; nameEn: string; pricePaisa: number };
type ProviderDetailServiceRowRaw = Omit<ProviderDetailServiceRow, 'pricePaisa'> & { pricePaisa: bigint };

export type ProviderDetailAreaRow = { areaId: number; name: string };

export type ProviderDetail = ProviderDetailRow & { services: ProviderDetailServiceRow[]; areas: ProviderDetailAreaRow[] };

@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Ranked by distance only: the fuller FR-SR-06 formula (rating, completion
   * rate, response speed, recent activity) has no real inputs yet, since
   * ratings (M9) and bookings (M5) don't exist. Adding weighted terms for
   * data that is always zero would just be a fake tie-breaker, so distance
   * is the whole ranking for now.
   */
  async searchProviders(query: ProviderSearchQuery): Promise<ProviderSearchResultRow[]> {
    const services = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM services WHERE slug = ${query.serviceSlug} AND is_active = true`);
    const service = services[0];
    if (service === undefined) throw notFound('Service');

    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography`;
    const raw = await this.prisma.$queryRaw<ProviderSearchResultRowRaw[]>(
      Prisma.sql`SELECT p.user_id as "providerId", p.bio, p.experience_years as "experienceYears", p.qualification, ps.price_paisa as "pricePaisa",
          ST_Distance(p.base_location, ${point}) as "distanceM"
        FROM providers p
        JOIN provider_services ps ON ps.provider_id = p.user_id AND ps.service_id = ${service.id} AND ps.status = 'APPROVED'
        WHERE p.status = 'APPROVED' AND p.base_location IS NOT NULL AND ST_DWithin(p.base_location, ${point}, p.radius_m)
        ORDER BY "distanceM" ASC`
    );
    return raw.map(row => ({ ...row, pricePaisa: Number(row.pricePaisa) }));
  }

  async getProviderDetail(providerId: string): Promise<ProviderDetail> {
    const profiles = await this.prisma.$queryRaw<ProviderDetailRow[]>(
      Prisma.sql`SELECT user_id as "providerId", status, bio, experience_years as "experienceYears", qualification, city_id as "cityId", radius_m as "radiusM"
        FROM providers WHERE user_id = ${providerId}::uuid AND status = 'APPROVED'`
    );
    const profile = profiles[0];
    if (profile === undefined) throw notFound('Provider');

    const servicesRaw = await this.prisma.$queryRaw<ProviderDetailServiceRowRaw[]>(
      Prisma.sql`SELECT s.id as "serviceId", s.slug, s.name_en as "nameEn", ps.price_paisa as "pricePaisa"
        FROM provider_services ps JOIN services s ON s.id = ps.service_id
        WHERE ps.provider_id = ${providerId}::uuid AND ps.status = 'APPROVED' AND s.is_active = true
        ORDER BY s.name_en`
    );
    const areas = await this.prisma.$queryRaw<ProviderDetailAreaRow[]>(
      Prisma.sql`SELECT a.id as "areaId", a.name FROM provider_service_areas psa JOIN areas a ON a.id = psa.area_id WHERE psa.provider_id = ${providerId}::uuid ORDER BY a.name`
    );

    return { ...profile, services: servicesRaw.map(row => ({ ...row, pricePaisa: Number(row.pricePaisa) })), areas };
  }
}
