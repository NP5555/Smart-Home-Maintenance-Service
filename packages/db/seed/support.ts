import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const json = (value: unknown): string => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

export const execute = async (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql);

export const rows = async <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql);

export const single = async <T>(sql: string): Promise<T | null> => (await rows<T>(sql))[0] ?? null;

export const exists = async (sql: string): Promise<boolean> => (await rows<{ present: boolean }>(sql))[0]?.present === true;

export type SeedStep = { name: string; run: () => Promise<void> };

export const runSeed = async (steps: readonly SeedStep[]): Promise<void> => {
  for (const step of steps) {
    await step.run();
    process.stdout.write(`seed: ${step.name}\n`);
  }
};
