import { z } from 'zod';
import { errorCodeSchema } from './errors.js';

export const fieldErrorSchema = z.object({ path: z.string().min(1), code: z.string().min(1), message: z.string().min(1) }).strict();
export const problemSchema = z.object({
  type: z.string().min(1), title: z.string().min(1), status: z.number().int().min(400).max(599), code: errorCodeSchema,
  detail: z.string().min(1), instance: z.string().optional(), requestId: z.string().optional(), errors: z.array(fieldErrorSchema)
}).strict();
export type Problem = z.infer<typeof problemSchema>;
