import { PrismaClient } from '@prisma/client';

export const prismaClientOptions = {
  log: process.env.PRISMA_LOG === 'query' ? (['query', 'info', 'warn', 'error'] as const) : (['warn', 'error'] as const)
};

export const createPrismaClient = (): PrismaClient => new PrismaClient({ log: prismaClientOptions });

export { PrismaClient };
export type { Prisma };
