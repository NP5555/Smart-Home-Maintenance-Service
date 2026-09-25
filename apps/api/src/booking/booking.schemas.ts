// apps/api/src/booking/booking.schemas.ts
import { z } from 'zod';

export const bookingCreateSchema = z
  .object({
    providerId: z.string().uuid(),
    serviceId: z.number().int().positive(),
    addressId: z.string().uuid(),
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime(),
    problemText: z.string().trim().min(1).max(2000).optional()
  })
  .strict()
  .refine(input => new Date(input.scheduledEnd).getTime() > new Date(input.scheduledStart).getTime(), { message: 'scheduledEnd must be after scheduledStart', path: ['scheduledEnd'] });

export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;

export const bookingListQuerySchema = z
  .object({
    status: z.enum(['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW']).optional()
  })
  .strict();

export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
