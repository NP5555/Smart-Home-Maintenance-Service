import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AvailabilityReplaceInput } from './provider.schemas.js';

export type AvailabilitySlotRow = { id: string; weekday: number; startTime: string; endTime: string };

type AvailabilitySlotRowRaw = { id: string; weekday: number; startTime: Date; endTime: Date };

const toHms = (value: Date): string => value.toISOString().slice(11, 16);

@Injectable()
export class AvailabilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listMine(providerId: string): Promise<AvailabilitySlotRow[]> {
    const raw = await this.prisma.$queryRaw<AvailabilitySlotRowRaw[]>(
      Prisma.sql`SELECT id, weekday, start_time as "startTime", end_time as "endTime" FROM provider_availability WHERE provider_id = ${providerId}::uuid ORDER BY weekday, start_time`
    );
    return raw.map(row => ({ ...row, startTime: toHms(row.startTime), endTime: toHms(row.endTime) }));
  }

  async replaceMine(providerId: string, items: AvailabilityReplaceInput['items']): Promise<AvailabilitySlotRow[]> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM provider_availability WHERE provider_id = ${providerId}::uuid`);
      const inserted: AvailabilitySlotRow[] = [];
      for (const item of items) {
        const rows = await tx.$queryRaw<AvailabilitySlotRowRaw[]>(
          Prisma.sql`INSERT INTO provider_availability(provider_id, weekday, start_time, end_time)
            VALUES (${providerId}::uuid, ${item.weekday}, ${item.startTime}::time, ${item.endTime}::time)
            RETURNING id, weekday, start_time as "startTime", end_time as "endTime"`
        );
        const row = rows[0];
        if (row !== undefined) inserted.push({ ...row, startTime: toHms(row.startTime), endTime: toHms(row.endTime) });
      }
      return inserted.sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
    });
  }
}
