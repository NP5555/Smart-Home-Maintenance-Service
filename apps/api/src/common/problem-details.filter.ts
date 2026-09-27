import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { PROBLEM_CONTENT_TYPE, buildProblem, errorCatalog, type ErrorCode, type FieldError } from '@smart-home/contracts';
import { REQUEST_ID_HEADER } from './redaction.js';
import { isUniqueViolation } from './unique-violation.js';

type ProblemBody = { code: ErrorCode; detail: string; errors: FieldError[] };

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = requestIdOf(request);
    const normalized = this.normalize(exception);
    const body = buildProblem({
      code: normalized.code,
      detail: normalized.detail,
      instance: request.originalUrl,
      requestId,
      errors: normalized.errors
    });
    if (normalized.code === 'INTERNAL_ERROR') {
      this.logger.error({ err: exception, requestId, url: request.originalUrl, code: normalized.code });
    }
    if (response.headersSent) return;
    response.status(body.status).type(PROBLEM_CONTENT_TYPE).json(body);
  }

  private normalize(exception: unknown): ProblemBody {
    if (exception instanceof HttpException) return this.fromHttp(exception);
    if (exception instanceof Prisma.PrismaClientKnownRequestError) return this.fromPrisma(exception);
    const transport = this.fromTransportError(exception);
    if (transport !== undefined) return transport;
    return { code: 'INTERNAL_ERROR', detail: 'An unexpected error occurred', errors: [] };
  }

  /**
   * The body parsers reject a request before it ever reaches a controller, and
   * they signal it with a plain Error carrying a `type` and a status rather than
   * an HttpException. Fastify answered those itself, so without this branch an
   * oversized or malformed body would have become a 500 where the API used to
   * answer 413/400.
   */
  private fromTransportError(exception: unknown): ProblemBody | undefined {
    if (typeof exception !== 'object' || exception === null) return undefined;
    const candidate = exception as { type?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
    const status = typeof candidate.status === 'number' ? candidate.status : typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined;
    if (status === undefined || status < 400 || status > 599) return undefined;
    const message = typeof candidate.message === 'string' && candidate.message.length > 0 ? candidate.message : 'The request could not be read';
    return { code: this.codeForStatus(status), detail: message, errors: [] };
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
    if (isUniqueViolation(exception)) return { code: 'CONFLICT', detail: 'The resource already exists', errors: [] };
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
      413: 'PAYLOAD_TOO_LARGE',
      502: 'ADAPTER_UNAVAILABLE'
    };
    if (status >= 500) return 'INTERNAL_ERROR';
    return byStatus[status] ?? 'BAD_REQUEST';
  }
}

export const requestIdOf = (request: Request): string => {
  if (request.requestId !== undefined) return request.requestId;
  const header = request.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
};
