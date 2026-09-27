import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';

export type HttpAdapter = ExpressAdapter;
export type HttpApplication = NestExpressApplication;

/**
 * The Express equivalent of the old Fastify options:
 *
 * - `trustProxy` so `@Ip()` and the rate limiter see the real client address
 *   from X-Forwarded-For, as `trustProxy: true` did on Fastify.
 * - `rawBody: true` on the factory call (see main.ts) gives `request.rawBody`
 *   as the exact bytes of a JSON body, which replaces the hand-written
 *   fastify-plugin preParsing hook the webhook signature check used to need.
 *
 * The 1 MiB body limit that Fastify enforced via `bodyLimit` is applied in
 * http-app.ts, because Express's own default is 100 KiB and silently lowering
 * it would reject payloads the current API accepts.
 */
export const createHttpAdapter = (): HttpAdapter => new ExpressAdapter();
