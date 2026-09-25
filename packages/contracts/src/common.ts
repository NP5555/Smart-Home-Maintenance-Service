import { z } from 'zod';

export const paisaSchema = z.bigint().min(0n);
export const moneySchema = z.object({ amountPaisa: paisaSchema, currency: z.literal('PKR') }).strict();
export type Paisa = bigint;
export type Money = z.infer<typeof moneySchema>;
export const cursorPageSchema = z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }).strict();
export const paginationQuerySchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export type CursorPage<T> = { data: T[]; page: z.infer<typeof cursorPageSchema> };
