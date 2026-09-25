import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE, buildProblem, errorCatalog, type ErrorCode, type FieldError } from '@smart-home/contracts';
import { REQUEST_ID_HEADER } from './redaction.js';

type ProblemBody = { code: ErrorCode; detail: string; errors: FieldError[] };

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const normalized = this.normalize(exception);
    const body = buildProblem({
      code: normalized.code,
      detail: normalized.detail,
      instance: request.url,
      requestId: String(request.id),
      errors: normalized.errors
    });
    if (normalized.code === 'INTERNAL_ERROR') {
      this.logger.error({ err: exception, requestId: String(request.id), url: request.url, code: normalized.code });
    }
    void reply.status(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
  }

  private normalize(exception: unknown): ProblemBody {
    if (exception instanceof HttpException) return this.fromHttp(exception);
    if (exception instanceof Prisma.PrismaClientKnownRequestError) return this.fromPrisma(exception);
    return { code: 'INTERNAL_ERROR', detail: 'An unexpected error occurred', errors: [] };
  }

  private fromHttp(exception: HttpException): ProblemBody {
    const status = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === 'string') return { code: this.codeForStatus(status), detail: response, errors: [] };
    if (typeof response !== 'object' || response === null) return { code: this.codeForStatus(status), detail: exception.message, errors: [] };
    const value = response as { code?: string; detail?: string; message?: string | string[]; errors?: FieldError[] };
    if (typeof value.code === 'string' && value.code in errorCatalog) {
      return { code: value.code as ErrorCode, detail: value.detail ?? exception.message, errors: value.errors ?? [] };
    }
    if (Array.isArray(value.errors)) return { code: 'VALIDATION_FAILED', detail: value.detail ?? 'Request validation failed', errors: value.errors };
    const message = Array.isArray(value.message) ? value.message.join('; ') : value.message;
    return { code: this.codeForStatus(status), detail: message ?? exception.message, errors: [] };
  }

  private fromPrisma(exception: Prisma.PrismaClientKnownRequestError): ProblemBody {
    if (exception.code === 'P2002') return { code: 'CONFLICT', detail: 'The resource already exists', errors: [] };
    if (exception.code === 'P2025') return { code: 'NOT_FOUND', detail: 'The resource was not found', errors: [] };
    if (exception.code === 'P2003') return { code: 'CONFLICT', detail: 'A related resource is missing', errors: [] };
    return { code: 'INTERNAL_ERROR', detail: 'A database error occurred', errors: [] };
  }

  private codeForStatus(status: number): ErrorCode {
    const byStatus: Record<number, ErrorCode> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_FAILED',
      423: 'OTP_LOCKED',
      429: 'RATE_LIMITED',
      502: 'ADAPTER_UNAVAILABLE'
    };
    if (status >= 500) return 'INTERNAL_ERROR';
    return byStatus[status] ?? 'BAD_REQUEST';
  }
}

export const requestIdOf = (request: FastifyRequest): string => {
  const header = request.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.length > 0 ? value : String(request.id);
};
