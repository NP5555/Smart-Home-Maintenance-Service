import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { FieldError } from '@smart-home/contracts';
import { validationFailed } from './domain-error.js';

export const toFieldErrors = (error: ZodError): FieldError[] =>
  error.issues.map(issue => ({ path: issue.path.length === 0 ? '(root)' : issue.path.map(segment => String(segment)).join('.'), code: issue.code, message: issue.message }));

export const parseWith = <Schema extends ZodTypeAny>(schema: Schema, value: unknown): z.infer<Schema> => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw validationFailed(toFieldErrors(result.error));
};

export const parseEnvironmentSection = <Schema extends ZodTypeAny>(schema: Schema, value: unknown): z.infer<Schema> => parseWith(schema, value);
