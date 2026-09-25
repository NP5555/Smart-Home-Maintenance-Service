import { z } from 'zod';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM in 24-hour time');

export const profileUpdateSchema = z
  .object({
    bio: z.string().trim().min(1).max(2000).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    qualification: z.string().trim().min(1).max(300).optional(),
    cityId: z.number().int().positive().optional(),
    baseAddressText: z.string().trim().min(1).max(300).optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    radiusM: z.number().int().min(500).max(50_000).optional()
  })
  .strict()
  .refine(input => (input.lat === undefined) === (input.lng === undefined), { message: 'lat and lng must be provided together', path: ['lat'] });

export const availabilityReplaceSchema = z
  .object({
    items: z
      .array(
        z
          .object({ weekday: z.number().int().min(0).max(6), startTime: time, endTime: time })
          .strict()
          .refine(item => item.startTime < item.endTime, { message: 'startTime must be before endTime', path: ['endTime'] })
      )
      .max(21)
  })
  .strict();

export const timeOffCreateSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    reason: z.string().trim().max(300).optional()
  })
  .strict()
  .refine(input => new Date(input.start).getTime() < new Date(input.end).getTime(), { message: 'start must be before end', path: ['end'] });

export const serviceAreasReplaceSchema = z
  .object({
    areaIds: z.array(z.number().int().positive()).max(50)
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type AvailabilityReplaceInput = z.infer<typeof availabilityReplaceSchema>;
export type TimeOffCreateInput = z.infer<typeof timeOffCreateSchema>;
export type ServiceAreasReplaceInput = z.infer<typeof serviceAreasReplaceSchema>;
