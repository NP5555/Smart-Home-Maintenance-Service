import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type RequestContextValue = {
  requestId: string;
  userId?: string;
  roles?: readonly string[];
  startedAt: number;
};

declare module 'express-serve-static-core' {
  interface Request {
    requestContext?: RequestContextValue;
    requestId?: string | undefined;
    rawBody?: Buffer | undefined;
  }
}

export const requestIdOfRequest = (request: Request): string => request.requestId ?? resolveRequestIdOf(request);

const resolveRequestIdOf = (request: Request): string => {
  const value = request.headers['x-request-id'];
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' && header.length > 0 && header.length <= 128 ? header : 'unknown';
};

export const RequestId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<Request>();
  return requestIdOfRequest(request);
});
