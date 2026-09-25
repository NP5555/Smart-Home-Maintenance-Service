import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('database invariants', () => {
  it('blocks physical user deletion', async () => {
    const row = await prisma.$queryRawUnsafe<{ id: string }[]>("SELECT id FROM users LIMIT 1");
    if (row[0]) await expect(prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${row[0].id}'`)).rejects.toThrow();
  });

  it('blocks audit log updates', async () => {
    await expect(prisma.$executeRawUnsafe("UPDATE audit_log SET action = 'changed' WHERE id = 1")).rejects.toThrow();
  });

  it('blocks ledger entry updates', async () => {
    await expect(prisma.$executeRawUnsafe("UPDATE ledger_entries SET amount_paisa = 1 WHERE id = 1")).rejects.toThrow();
  });
});
