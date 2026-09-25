import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export type RequestContextValue = {
  requestId: string;
  userId?: string;
  roles?: readonly string[];
  startedAt: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    requestContext?: RequestContextValue;
  }
}

export const requestIdOfRequest = (request: FastifyRequest): string => {
  const value = request.headers['x-request-id'];
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' && header.length > 0 && header.length <= 128 ? header : String(request.id);
};

export const RequestId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  return requestIdOfRequest(request);
});
