import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { TOKENS, type AuthSecrets } from './auth-secrets.js';
import { hashRefreshToken, issueRefreshToken } from './tokens.js';

export type SessionMeta = { userAgent?: string | undefined; ip?: string | undefined };

export type IssuedSession = { sessionId: string; refreshToken: string; refreshExpiresAt: string };

export type RotatedSession = IssuedSession & { userId: string };

type SessionRow = { id: string; user_id: string; family_id: string; revoked_at: Date | null; replaced_by: string | null };

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TOKENS) private readonly secrets: AuthSecrets
  ) {}

  /** Opens a brand new rotation family, as at first sign in. */
  async start(userId: string, meta: SessionMeta): Promise<IssuedSession> {
    return this.insert(userId, randomUUID(), meta);
  }

  /**
   * Single-use rotation. A legitimate client only ever holds the newest token,
   * so presenting one that was already rotated means it leaked and both copies
   * may be in use: the whole family is revoked, signing out the thief and the
   * victim alike.
   *
   * A token revoked on purpose (logout, a password change) is different. That
   * is not reuse, so it is reported as a plain unauthenticated request rather
   * than tearing down every sibling session.
   */
  async rotate(presented: string, meta: SessionMeta): Promise<RotatedSession> {
    const hash = hashRefreshToken(presented);
    const rows = await this.prisma.$queryRaw<SessionRow[]>(
      Prisma.sql`SELECT id, user_id, family_id, revoked_at, replaced_by FROM sessions WHERE refresh_token_hash = ${hash} FOR UPDATE`
    );
    const session = rows[0];
    if (session === undefined) throw new DomainError('UNAUTHENTICATED', 'The refresh token is not valid');
    if (session.revoked_at !== null) {
      // `replaced_by` is set only when this token was rotated away, which is
      // what separates a leak from a deliberate logout or password change.
      if (session.replaced_by === null && !(await this.familyWasCompromised(session.family_id))) {
        throw new DomainError('UNAUTHENTICATED', 'The refresh token is no longer valid');
      }
      await this.revokeFamily(session.family_id);
      throw new DomainError('REFRESH_REUSE_DETECTED', 'This refresh token was already used. Every session in the family has been signed out.');
    }
    const issued = await this.insert(session.user_id, session.family_id, meta);
    // The replacement is recorded on the row that was rotated away, not on the
    // new one. `replaced_by` therefore reads as "this token was replaced by
    // that one", which is what makes the reuse check above correct for the very
    // first token of a family and not only for ones that came from a rotation.
    await this.prisma.$queryRaw(Prisma.sql`UPDATE sessions SET revoked_at = now(), replaced_by = ${issued.sessionId}::uuid WHERE id = ${session.id}::uuid`);
    return { userId: session.user_id, ...issued };
  }

  async revoke(presented: string): Promise<void> {
    const hash = hashRefreshToken(presented);
    await this.prisma.$queryRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = ${hash} AND revoked_at IS NULL`);
  }

  async revokeFamily(familyId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE family_id = ${familyId}::uuid AND revoked_at IS NULL`);
  }

  /**
   * True when some row in the family was revoked by a rotation rather than on
   * purpose. A token caught up in the collateral revocation that follows a leak
   * should keep reporting reuse, so the client keeps telling the user to sign in
   * again instead of seeing a bare 401 and retrying.
   */
  private async familyWasCompromised(familyId: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<{ present: boolean }[]>(
      Prisma.sql`SELECT EXISTS (SELECT 1 FROM sessions WHERE family_id = ${familyId}::uuid AND revoked_at IS NOT NULL AND replaced_by IS NOT NULL) AS present`
    );
    return row?.present === true;
  }

  /** Used after a password change: FR-CU-04 in SHM-020 requires every other session to die. */
  async revokeAllForUser(userId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`);
  }

  private async insert(userId: string, familyId: string, meta: SessionMeta): Promise<IssuedSession> {
    const issued = issueRefreshToken(this.secrets);
    const [row] = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO sessions(user_id, family_id, refresh_token_hash, user_agent, ip, expires_at)
                 VALUES (${userId}::uuid, ${familyId}::uuid, ${issued.hash}, ${meta.userAgent ?? null}, ${meta.ip ?? null}::inet, ${issued.expiresAt})
                 RETURNING id`
    );
    if (row === undefined) throw new DomainError('INTERNAL_ERROR', 'The session could not be created');
    return { sessionId: row.id, refreshToken: issued.token, refreshExpiresAt: issued.expiresAt.toISOString() };
  }
}
