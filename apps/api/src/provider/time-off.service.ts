import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { TimeOffCreateInput } from './provider.schemas.js';

export type TimeOffRow = { id: string; start: Date; end: Date; reason: string | null; createdAt: Date };

const EXCLUSION_VIOLATION = '23P01';

@Injectable()
export class TimeOffService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listMine(providerId: string): Promise<TimeOffRow[]> {
    return this.prisma.$queryRaw<TimeOffRow[]>(
      Prisma.sql`SELECT id, lower(period) as "start", upper(period) as "end", reason, created_at as "createdAt" FROM provider_time_off WHERE provider_id = ${providerId}::uuid ORDER BY lower(period)`
    );
  }

  async createMine(providerId: string, input: TimeOffCreateInput): Promise<TimeOffRow> {
    try {
      const rows = await this.prisma.$queryRaw<TimeOffRow[]>(
        Prisma.sql`INSERT INTO provider_time_off(provider_id, period, reason)
          VALUES (${providerId}::uuid, tstzrange(${input.start}::timestamptz, ${input.end}::timestamptz, '[)'), ${input.reason ?? null})
          RETURNING id, lower(period) as "start", upper(period) as "end", reason, created_at as "createdAt"`
      );
      const row = rows[0];
      if (row === undefined) throw new Error('Time off insert did not return a row');
      return row;
    } catch (error) {
      throw this.describeConflict(error);
    }
  }

  async cancelMine(providerId: string, id: string): Promise<void> {
    const affected = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM provider_time_off WHERE id = ${id}::uuid AND provider_id = ${providerId}::uuid`);
    if (affected === 0) throw notFound('Time off period');
  }

  private describeConflict(error: unknown): Error {
    const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown } | undefined) : undefined;
    if (meta?.code === EXCLUSION_VIOLATION) return conflict('This leave period overlaps one you already have on file');
    return error instanceof Error ? error : new Error('Time off could not be recorded');
  }
}
