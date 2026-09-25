import { z } from 'zod';

export const providerSearchQuerySchema = z
  .object({
    serviceSlug: z.string().trim().min(1).max(100),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180)
  })
  .strict();

export type ProviderSearchQuery = z.infer<typeof providerSearchQuerySchema>;
