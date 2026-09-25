import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export type AuditEntry = { actorUserId: string | null; actorRole: 'CUSTOMER' | 'PROVIDER' | 'AGENT' | 'FINANCE' | 'ADMIN' | 'SYSTEM'; action: string; entityType: string; entityId: string; before?: Prisma.InputJsonValue | null; after?: Prisma.InputJsonValue | null; ip?: string | null; userAgent?: string | null; requestId?: string | null };

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(entry: AuditEntry, client: PrismaService | Prisma.TransactionClient = this.prisma): Promise<void> {
    await client.$executeRaw(Prisma.sql`INSERT INTO audit_log(actor_user_id, actor_role, action, entity_type, entity_id, before, after, ip, user_agent, request_id) VALUES (${entry.actorUserId}::uuid, ${entry.actorRole}::actor_role, ${entry.action}, ${entry.entityType}, ${entry.entityId}, ${JSON.stringify(entry.before ?? null)}::jsonb, ${JSON.stringify(entry.after ?? null)}::jsonb, ${entry.ip ?? null}::inet, ${entry.userAgent ?? null}, ${entry.requestId ?? null})`);
  }
}
