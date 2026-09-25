import { HttpException } from '@nestjs/common';
import { errorCatalog, type ErrorCode, type FieldError } from '@smart-home/contracts';

export class DomainError extends HttpException {
  readonly code: ErrorCode;
  readonly fieldErrors: FieldError[];

  constructor(code: ErrorCode, detail: string, errors: FieldError[] = []) {
    super({ code, detail, errors }, errorCatalog[code].status);
    this.code = code;
    this.fieldErrors = errors;
  }
}

export const notFound = (what: string): DomainError => new DomainError('NOT_FOUND', `${what} was not found`);

export const badRequest = (detail: string, errors: FieldError[] = []): DomainError => new DomainError('BAD_REQUEST', detail, errors);

export const forbidden = (detail: string): DomainError => new DomainError('FORBIDDEN', detail);

export const conflict = (detail: string): DomainError => new DomainError('CONFLICT', detail);

export const validationFailed = (errors: FieldError[], detail = 'Request validation failed'): DomainError => new DomainError('VALIDATION_FAILED', detail, errors);
