import { z } from 'zod';

export const providerRejectSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export type ProviderRejectInput = z.infer<typeof providerRejectSchema>;
