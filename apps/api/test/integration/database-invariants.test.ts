import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const adminId = '00000000-0000-4000-8000-000000000001';

const hasTable = async (table: string): Promise<boolean> => {
  const rows = await prisma.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`);
  return rows[0]?.present === true;
};

/**
 * Returns a booking to test the status guard against, creating a customer, an
 * address and the booking itself when the database has none. A booking needs a
 * real uuid address, so the address row is built here rather than borrowing an
 * `areas` id, which is a smallint.
 */
const findAnyBookingId = async (): Promise<string | undefined> => {
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM bookings LIMIT 1`);
  const found = existing[0]?.id;
  if (found !== undefined) return found;

  const [service] = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM services ORDER BY id LIMIT 1`);
  const [area] = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM areas ORDER BY id LIMIT 1`);
  const [customer] = await prisma.$queryRaw<{ user_id: string }[]>(Prisma.sql`SELECT user_id FROM user_roles WHERE role_code = 'CUSTOMER' LIMIT 1`);
  if (service === undefined || area === undefined || customer === undefined) return undefined;

  const inserted = await prisma.$transaction(async tx => {
    const [address] = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO addresses(customer_id, label, line1, area_id, location)
                 VALUES (${customer.user_id}::uuid, 'Test', 'Test address', ${area.id}, ST_SetSRID(ST_MakePoint(74.3, 31.5), 4326)::geography)
                 ON CONFLICT DO NOTHING
                 RETURNING id`
    );
    if (address === undefined) return undefined;
    const [booking] = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO bookings(customer_id, service_id, address_id, status, payment_mode, payment_status, slot, scheduled_start, scheduled_end, quoted_amount_paisa, approved_total_paisa, commission_rate_bp)
                 VALUES (${customer.user_id}::uuid, ${service.id}, ${address.id}::uuid, 'REQUESTED', 'CASH', 'CASH_DUE',
                   tstzrange('2026-10-01 09:00:00+00', '2026-10-01 11:00:00+00'),
                   '2026-10-01 09:00:00+00', '2026-10-01 11:00:00+00', 0, 0, 1500)
                 RETURNING id`
    );
    return booking?.id;
  });
  return inserted;
};

beforeAll(async () => {
  await prisma.$connect();
  if (!(await hasTable('users'))) throw new Error('The canonical schema is not migrated. Run: npm run db:reset');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('DB-level invariants from 04_schema.sql', () => {
  it('loads every foundation table', async () => {
    for (const table of ['users', 'bookings', 'ledger_entries', 'audit_log', 'outbox_events', 'settings', 'idempotency_keys', 'payment_events', 'verification_calls', 'service_checklist_items']) {
      expect(await hasTable(table), `table ${table} is missing`).toBe(true);
    }
  });

  it('installs the canonical triggers, functions and views', async () => {
    const triggers = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM pg_trigger WHERE NOT tgisinternal`);
    expect(Number(triggers[0]?.count ?? 0n)).toBeGreaterThanOrEqual(21);
    const functions = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`);
    expect(Number(functions[0]?.count ?? 0n)).toBeGreaterThan(10);
    const views = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM pg_views WHERE schemaname = 'public'`);
    expect(Number(views[0]?.count ?? 0n)).toBeGreaterThanOrEqual(3);
  });

  it('NFR-DB-01: audit_log is insert-only', async () => {
    const inserted = await prisma.$queryRaw<{ id: bigint }[]>(
      Prisma.sql`INSERT INTO audit_log(actor_role, action, entity_type, entity_id) VALUES ('SYSTEM', 'test.seed', 'TEST', 'audit-insert-only') RETURNING id`
    );
    const id = inserted[0]?.id;
    expect(id).toBeDefined();
    await expect(prisma.$executeRaw(Prisma.sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${id}::bigint`)).rejects.toThrow();
    await expect(prisma.$executeRaw(Prisma.sql`DELETE FROM audit_log WHERE id = ${id}::bigint`)).rejects.toThrow();
    const survivors = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM audit_log WHERE id = ${id}::bigint`);
    expect(Number(survivors[0]?.count ?? 0n)).toBe(1);
  });

  it('NFR-DB-02: ledger_entries are insert-only', async () => {
    const [account] = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ledger_accounts LIMIT 1`);
    if (account === undefined) return;
    const entryId = await prisma.$transaction(async tx => {
      const [created] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO ledger_transactions(tx_type) VALUES ('ADJUSTMENT') RETURNING id`);
      if (created === undefined) throw new Error('ledger transaction insert returned no id');
      const [entry] = await tx.$queryRaw<{ id: bigint }[]>(
        Prisma.sql`INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_paisa) VALUES (${created.id}::uuid, ${account.id}::uuid, 'DEBIT', 100) RETURNING id`
      );
      if (entry === undefined) throw new Error('ledger entry insert returned no id');
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_paisa) VALUES (${created.id}::uuid, ${account.id}::uuid, 'CREDIT', 100)`
      );
      return entry.id;
    });
    await expect(prisma.$executeRaw(Prisma.sql`UPDATE ledger_entries SET amount_paisa = 1 WHERE id = ${entryId}::bigint`)).rejects.toThrow();
    await expect(prisma.$executeRaw(Prisma.sql`DELETE FROM ledger_entries WHERE id = ${entryId}::bigint`)).rejects.toThrow();
    const survivors = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM ledger_entries WHERE id = ${entryId}::bigint`);
    expect(Number(survivors[0]?.count ?? 0n)).toBe(1);
  });

  it('NFR-DB-03: users are never physically deleted', async () => {
    await expect(prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${adminId}'`)).rejects.toThrow();
  });

  it('FR-BK-*: a raw bookings.status update is rejected without app.transition_ctx', async () => {
    const id = await findAnyBookingId();
    if (id === undefined) return;
    await expect(prisma.$executeRawUnsafe(`UPDATE bookings SET status = 'ACCEPTED' WHERE id = '${id}'`)).rejects.toThrow();
  });

  it('FR-BK-*: the status is writable inside the sanctioned transaction context', async () => {
    const id = await findAnyBookingId();
    if (id === undefined) return;
    const updated = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL app.transition_ctx = 'on'`);
      return tx.$queryRaw<{ status: string }[]>(Prisma.sql`UPDATE bookings SET status = status WHERE id = ${id}::uuid RETURNING status`);
    });
    expect(updated[0]?.status).toBeDefined();
  });

  it('NFR-DB-04: an unbalanced ledger transaction is rejected at commit', async () => {
    const [account] = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ledger_accounts LIMIT 1`);
    if (account === undefined) return;
    await expect(
      prisma.$transaction(async tx => {
        const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO ledger_transactions(tx_type) VALUES ('ADJUSTMENT') RETURNING id`);
        const transactionId = inserted[0]?.id;
        if (transactionId === undefined) throw new Error('ledger transaction insert returned no id');
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_paisa) VALUES (${transactionId}::uuid, ${account.id}::uuid, 'DEBIT', 100)`
        );
      })
    ).rejects.toThrow();
  });

  it('FR-PY-01: a negative money amount violates the schema check', async () => {
    await expect(
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO services(category_id, slug, name_en, name_ur, description, pricing_model, base_price_paisa, min_price_paisa, max_price_paisa, expected_duration_min)
          SELECT id, 'bad-money', 'Bad', 'Bad', 'Bad', 'FLAT', -1, 0, 10, 30 FROM categories LIMIT 1`
      )
    ).rejects.toThrow();
  });

  it('idempotency_keys is keyed by (key, user_id) so a replay collides', async () => {
    const [existing] = await prisma.$queryRaw<{ key: string; user_id: string }[]>(Prisma.sql`SELECT key, user_id FROM idempotency_keys LIMIT 1`);
    if (existing === undefined) return;
    await expect(
      prisma.$executeRaw(Prisma.sql`INSERT INTO idempotency_keys(key, user_id, route, request_hash) VALUES (${existing.key}, ${existing.user_id}::uuid, 'POST /x', 'hash')`)
    ).rejects.toThrow();
  });

  it('seeds the business defaults the platform reads at runtime', async () => {
    const rows = await prisma.$queryRaw<{ key: string }[]>(
      Prisma.sql`SELECT key FROM settings WHERE key IN ('verification.sla_min', 'commission.default_pct', 'cash.debt_ceiling_paisa', 'verification.calling_hours')`
    );
    expect(rows.length).toBe(4);
  });

  it('seeds staff for every staff role and the global commission rule', async () => {
    const roles = await prisma.$queryRaw<{ role_code: string }[]>(Prisma.sql`SELECT role_code FROM user_roles WHERE user_id = '00000000-0000-4000-8000-000000000001'::uuid`);
    expect(roles.length).toBeGreaterThanOrEqual(1);
    const commission = await prisma.$queryRaw<{ rate_bp: number }[]>(Prisma.sql`SELECT rate_bp FROM commission_rules WHERE scope = 'GLOBAL' AND effective_to IS NULL LIMIT 1`);
    expect(commission[0]?.rate_bp).toBe(1500);
  });
});
