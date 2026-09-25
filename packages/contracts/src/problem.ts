import { z } from 'zod';
import { errorCodeSchema, problemTypeFor, statusForCode, titleForCode, type ErrorCode } from './errors.js';

export const fieldErrorSchema = z
  .object({
    path: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

export const problemSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    code: errorCodeSchema,
    detail: z.string().min(1),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z.array(fieldErrorSchema)
  })
  .strict();

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type Problem = z.infer<typeof problemSchema>;

export type ProblemInput = { code: ErrorCode; detail: string; instance?: string; requestId?: string; errors?: FieldError[] };

export const buildProblem = (input: ProblemInput): Problem =>
  problemSchema.parse({
    type: problemTypeFor(input.code),
    title: titleForCode(input.code),
    status: statusForCode(input.code),
    code: input.code,
    detail: input.detail,
    ...(input.instance === undefined ? {} : { instance: input.instance }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    errors: input.errors ?? []
  });
