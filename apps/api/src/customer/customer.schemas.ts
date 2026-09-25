import { z } from 'zod';

const label = z.string().trim().min(1).max(100);
const line = z.string().trim().min(1).max(300);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const addressCreateSchema = z
  .object({
    label,
    line1: line,
    line2: line.optional(),
    areaId: z.number().int().positive(),
    lat,
    lng,
    notes: z.string().trim().max(500).optional(),
    isDefault: z.boolean().default(false)
  })
  .strict();

export const addressUpdateSchema = z
  .object({
    label: label.optional(),
    line1: line.optional(),
    line2: line.optional(),
    areaId: z.number().int().positive().optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    notes: z.string().trim().max(500).optional(),
    isDefault: z.boolean().optional()
  })
  .strict()
  .refine(input => (input.lat === undefined) === (input.lng === undefined), { message: 'lat and lng must be provided together', path: ['lat'] });

export type AddressCreateInput = z.infer<typeof addressCreateSchema>;
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;
