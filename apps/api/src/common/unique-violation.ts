/**
 * Detects a unique-constraint violation from the database.
 *
 * Two different shapes reach us for the same failure. Prisma's model-based
 * queries rewrite the conflict into `PrismaClientKnownRequestError` with code
 * `P2002`, but a query issued through `$queryRaw`/`$executeRaw` is passed
 * through to the driver unchanged, so the same conflict arrives as SQLSTATE
 * `23505` on the error itself.
 *
 * The idempotency table is written with raw SQL, and booking overlap checks use
 * raw queries as well, so matching only on `P2002` silently turns a duplicate
 * key into a 500 instead of the documented 201/422. Both callers match on this
 * predicate so the two shapes cannot drift apart again.
 */
export const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown; target?: unknown } };
  if (candidate.code === 'P2002' || candidate.code === '23505') return true;
  // Postgres sometimes reports the conflict one layer deeper, under meta.
  return candidate.meta?.code === '23505';
};
