import { z } from 'zod';
import { Locale } from './enums.js';

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const localeSchema = Locale.schema;
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)]));

export const idParamSchema = z.object({ id: uuidSchema }).strict();

export const versionSchema = z.object({ version: z.number().int().nonnegative() }).strict();

export const okSchema = z.object({ ok: z.literal(true) }).strict();

export const healthCheckSchema = z.object({ up: z.boolean() }).strict();

export type LocaleInput = z.infer<typeof localeSchema>;
