import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { errorCatalog, problemSchema, type ErrorCode } from '@smart-home/contracts';

type ProblemBody = { code: ErrorCode; detail: string; errors: { path: string; code: string; message: string }[] };

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const normalized = this.normalize(exception);
    const catalog = errorCatalog[normalized.code];
    const body = problemSchema.parse({
      type: `https://smart-home.local/problems/${normalized.code.toLowerCase().replaceAll('_', '-')}`,
      title: catalog.title,
      status: catalog.status,
      code: normalized.code,
      detail: normalized.detail,
      instance: request.url,
      requestId: String(request.id),
      errors: normalized.errors
    });
    void reply.status(catalog.status).type('application/problem+json').send(body);
  }

  private normalize(exception: unknown): ProblemBody {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null) {
        const value = response as { code?: ErrorCode; detail?: string; message?: string | string[]; errors?: ProblemBody['errors'] };
        if (value.code && errorCatalog[value.code]) return { code: value.code, detail: value.detail ?? 'Request failed', errors: value.errors ?? [] };
        if (value.errors) return { code: 'VALIDATION_FAILED', detail: 'Request validation failed', errors: value.errors };
        const message = Array.isArray(value.message) ? value.message.join('; ') : value.message;
        return { code: exception.getStatus() === 401 ? 'UNAUTHENTICATED' : 'BAD_REQUEST', detail: message ?? 'Request failed', errors: [] };
      }
    }
    return { code: 'INTERNAL_ERROR', detail: 'An unexpected error occurred', errors: [] };
  }
}
