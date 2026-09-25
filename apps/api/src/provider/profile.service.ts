import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ProfileUpdateInput } from './provider.schemas.js';

export type ProviderProfileRow = {
  userId: string;
  status: string;
  bio: string | null;
  experienceYears: number | null;
  qualification: string | null;
  cityId: number | null;
  baseAddressText: string | null;
  lat: number | null;
  lng: number | null;
  radiusM: number;
};

const PROFILE_COLUMNS = Prisma.sql`user_id as "userId", status, bio, experience_years as "experienceYears", qualification, city_id as "cityId", base_address_text as "baseAddressText",
  ST_Y(base_location::geometry) as lat, ST_X(base_location::geometry) as lng, radius_m as "radiusM"`;

@Injectable()
export class ProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getMine(providerId: string): Promise<ProviderProfileRow> {
    const rows = await this.prisma.$queryRaw<ProviderProfileRow[]>(Prisma.sql`SELECT ${PROFILE_COLUMNS} FROM providers WHERE user_id = ${providerId}::uuid`);
    const row = rows[0];
    if (row === undefined) throw notFound('Provider profile');
    return row;
  }

  async updateMine(providerId: string, input: ProfileUpdateInput): Promise<ProviderProfileRow> {
    if (input.cityId !== undefined) {
      const cities = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM cities WHERE id = ${input.cityId} AND is_active = true`);
      if (cities.length === 0) throw notFound('City');
    }
    const hasPoint = input.lat !== undefined && input.lng !== undefined;
    const rows = await this.prisma.$queryRaw<ProviderProfileRow[]>(
      Prisma.sql`UPDATE providers SET
          bio = COALESCE(${input.bio ?? null}, bio),
          experience_years = COALESCE(${input.experienceYears ?? null}, experience_years),
          qualification = COALESCE(${input.qualification ?? null}, qualification),
          city_id = COALESCE(${input.cityId ?? null}, city_id),
          base_address_text = COALESCE(${input.baseAddressText ?? null}, base_address_text),
          base_location = ${hasPoint ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography` : Prisma.sql`base_location`},
          radius_m = COALESCE(${input.radiusM ?? null}, radius_m),
          updated_at = now()
        WHERE user_id = ${providerId}::uuid
        RETURNING ${PROFILE_COLUMNS}`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Provider profile');
    return row;
  }
}
