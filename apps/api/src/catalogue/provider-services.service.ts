import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ProviderServiceListQuery } from './catalogue.schemas.js';

export type ProviderServiceRow = { providerId: string; serviceId: number; serviceSlug: string; serviceNameEn: string; pricePaisa: number; status: string; createdAt: Date };

type ProviderServiceRowRaw = Omit<ProviderServiceRow, 'pricePaisa'> & { pricePaisa: bigint };

const toRow = (raw: ProviderServiceRowRaw): ProviderServiceRow => ({ ...raw, pricePaisa: Number(raw.pricePaisa) });

const ROW_COLUMNS = Prisma.sql`ps.provider_id as "providerId", ps.service_id as "serviceId", s.slug as "serviceSlug", s.name_en as "serviceNameEn", ps.price_paisa as "pricePaisa", ps.status, ps.created_at as "createdAt"`;

@Injectable()
export class ProviderServicesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listMine(providerId: string): Promise<ProviderServiceRow[]> {
    const raw = await this.prisma.$queryRaw<ProviderServiceRowRaw[]>(
      Prisma.sql`SELECT ${ROW_COLUMNS} FROM provider_services ps JOIN services s ON s.id = ps.service_id WHERE ps.provider_id = ${providerId}::uuid ORDER BY ps.created_at DESC`
    );
    return raw.map(toRow);
  }

  async upsertMine(providerId: string, serviceId: number, pricePaisa: number): Promise<ProviderServiceRow> {
    const services = await this.prisma.$queryRaw<{ minPricePaisa: bigint; maxPricePaisa: bigint }[]>(
      Prisma.sql`SELECT min_price_paisa as "minPricePaisa", max_price_paisa as "maxPricePaisa" FROM services WHERE id = ${serviceId} AND is_active = true`
    );
    const service = services[0];
    if (service === undefined) throw notFound('Service');
    if (pricePaisa < Number(service.minPricePaisa) || pricePaisa > Number(service.maxPricePaisa)) {
      throw badRequest(`pricePaisa must be between ${service.minPricePaisa} and ${service.maxPricePaisa} for this service`);
    }
    const raw = await this.prisma.$queryRaw<ProviderServiceRowRaw[]>(
      Prisma.sql`INSERT INTO provider_services(provider_id, service_id, price_paisa, status)
        VALUES (${providerId}::uuid, ${serviceId}, ${BigInt(pricePaisa)}, 'PENDING'::approval_status)
        ON CONFLICT (provider_id, service_id) DO UPDATE SET price_paisa = EXCLUDED.price_paisa
        RETURNING provider_id as "providerId", service_id as "serviceId", price_paisa as "pricePaisa", status, created_at as "createdAt"`
    );
    const row = raw[0];
    if (row === undefined) throw new Error('Provider service upsert did not return a row');
    const withService = await this.prisma.$queryRaw<{ serviceSlug: string; serviceNameEn: string }[]>(Prisma.sql`SELECT slug as "serviceSlug", name_en as "serviceNameEn" FROM services WHERE id = ${serviceId}`);
    return toRow({ ...row, ...withService[0]! });
  }

  async removeMine(providerId: string, serviceId: number): Promise<void> {
    const affected = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM provider_services WHERE provider_id = ${providerId}::uuid AND service_id = ${serviceId}`);
    if (affected === 0) throw notFound('Provider service binding');
  }

  async listForAdmin(filter: ProviderServiceListQuery): Promise<ProviderServiceRow[]> {
    const raw = await this.prisma.$queryRaw<ProviderServiceRowRaw[]>(
      Prisma.sql`SELECT ${ROW_COLUMNS} FROM provider_services ps JOIN services s ON s.id = ps.service_id
        WHERE (${filter.status ?? null}::approval_status IS NULL OR ps.status = ${filter.status ?? null}::approval_status)
        ORDER BY ps.created_at`
    );
    return raw.map(toRow);
  }

  async setStatus(providerId: string, serviceId: number, status: 'APPROVED' | 'REJECTED'): Promise<ProviderServiceRow> {
    const raw = await this.prisma.$queryRaw<ProviderServiceRowRaw[]>(
      Prisma.sql`UPDATE provider_services ps SET status = ${status}::approval_status
        FROM services s
        WHERE ps.provider_id = ${providerId}::uuid AND ps.service_id = ${serviceId} AND s.id = ps.service_id
        RETURNING ${ROW_COLUMNS}`
    );
    const row = raw[0];
    if (row === undefined) throw notFound('Provider service binding');
    return toRow(row);
  }
}
