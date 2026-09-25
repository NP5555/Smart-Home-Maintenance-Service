import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const paginationQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
  })
  .strict();

export const cursorPageSchema = z
  .object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean()
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type CursorPage = z.infer<typeof cursorPageSchema>;
export type Page<T> = { data: T[]; page: CursorPage };

export const buildPage = <T>(rows: T[], limit: number, toCursor: (row: T) => string): Page<T> => {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return { data, page: { nextCursor: hasMore && last !== undefined ? toCursor(last) : null, hasMore } };
};

export const decodeCursor = (cursor: string | undefined): { key: string; id: string } | null => {
  if (cursor === undefined) return null;
  const separator = cursor.indexOf('|');
  if (separator < 1) return null;
  return { key: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
};

export const encodeCursor = (key: string, id: string): string => `${key}|${id}`;
