import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';

export type ProviderApprovalRow = { userId: string; status: string; approvedAt: Date | null; approvedBy: string | null; rejectionReason: string | null };

const APPROVAL_COLUMNS = Prisma.sql`user_id as "userId", status, approved_at as "approvedAt", approved_by as "approvedBy", rejection_reason as "rejectionReason"`;

@Injectable()
export class ProviderApprovalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async approve(providerId: string, adminId: string): Promise<ProviderApprovalRow> {
    const rows = await this.prisma.$queryRaw<ProviderApprovalRow[]>(
      Prisma.sql`UPDATE providers SET status = 'APPROVED', approved_at = now(), approved_by = ${adminId}::uuid, rejection_reason = NULL
        WHERE user_id = ${providerId}::uuid RETURNING ${APPROVAL_COLUMNS}`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Provider');
    return row;
  }

  async reject(providerId: string, reason: string): Promise<ProviderApprovalRow> {
    const rows = await this.prisma.$queryRaw<ProviderApprovalRow[]>(
      Prisma.sql`UPDATE providers SET status = 'REJECTED', rejection_reason = ${reason}, approved_at = NULL, approved_by = NULL
        WHERE user_id = ${providerId}::uuid RETURNING ${APPROVAL_COLUMNS}`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Provider');
    return row;
  }
}
