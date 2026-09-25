import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * The API validates every request body with the Zod schema that already
 * exists in each *.schemas.ts file (see parseWith). Swagger can't see that
 * automatically because the handler signature is `@Body() body: unknown`,
 * so without this the generated docs show no request shape at all.
 * Deriving the OpenAPI schema from the same Zod schema keeps one source of
 * truth instead of hand-duplicating a second description that can drift.
 */
export const ApiZodBody = (schema: ZodTypeAny, examples?: Record<string, { summary: string; value: unknown }>): MethodDecorator =>
  applyDecorators(ApiBody({ schema: zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>, examples }));

/**
 * Same idea for simple query-string filters, one field per call: renders a
 * named, typed "Try it out" input instead of an unlabelled query string.
 */
export const ApiQueryField = (name: string, options: { description?: string; type?: 'string' | 'number' | 'boolean'; enum?: readonly string[]; required?: boolean } = {}): MethodDecorator =>
  ApiQuery({ name, required: options.required ?? false, type: options.enum === undefined ? (options.type ?? 'string') : undefined, enum: options.enum as string[] | undefined, description: options.description });
