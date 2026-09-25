import { HttpException } from '@nestjs/common';
import { errorCatalog, type ErrorCode } from '@smart-home/contracts';

export class DomainError extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, detail: string, errors: { path: string; code: string; message: string }[] = []) {
    super({ code, detail, errors }, errorCatalog[code].status);
    this.code = code;
  }
}
