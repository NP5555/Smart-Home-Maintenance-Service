import { Readable } from 'node:stream';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import './request-context.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const isJsonBody = (request: FastifyRequest): boolean => {
  if (!BODY_METHODS.has(request.method.toUpperCase())) return false;
  return (request.headers['content-type'] ?? '').toLowerCase().includes('application/json');
};

/**
 * Captures the exact bytes of a JSON body so webhook signature verification can
 * hash what the client actually sent. Implemented as a preParsing hook rather
 * than an extra content type parser, because registering a second
 * `application/json` parser collides with the one Nest installs.
 *
 * Wrapped in fastify-plugin so the hook is added to the root scope; a bare
 * `app.register` would create a child context and never see Nest's routes.
 */
export const rawBodyPlugin: FastifyPluginAsync = fp(
  async instance => {
    instance.addHook('preParsing', async (request, _reply, payload) => {
      if (!isJsonBody(request)) return payload;
      const chunks: Buffer[] = [];
      for await (const chunk of payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      const body = Buffer.concat(chunks);
      request.rawBody = body;
      // Wrapped in an array on purpose: Readable.from(buffer) would iterate the
      // buffer byte by byte and hand the JSON parser a stream of numbers.
      return Readable.from([body]);
    });
  },
  { name: 'smart-home-raw-body' }
);
