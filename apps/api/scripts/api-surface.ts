/**
 * Dumps the public HTTP surface of the application so a refactor can prove it
 * did not move, rename or drop a single endpoint.
 *
 * The surface is read from the generated OpenAPI document rather than by
 * introspecting the HTTP adapter, because the OpenAPI document is built the
 * same way on every adapter. That means one command produces a comparable
 * snapshot on Fastify and on Express, which is the entire point: a diff
 * between the two runs is the evidence that the API did not change.
 *
 * The document is built with `buildOpenApiConfig`, the very function
 * `configureHttpApp` uses, so the snapshot covers the description, tag list and
 * server list that clients actually read from `/api/docs` and not just the
 * operation list.
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHttpAdapter } from '../src/adapter.js';
import { AppModule } from '../src/app.module.js';
import { EnvironmentService } from '../src/config/environment.service.js';
import { GLOBAL_PREFIX, OPENAPI_PATH, buildOpenApiConfig, configureHttpApp, registerHttpPlugins } from '../src/http-app.js';
import { SettingsService } from '../src/platform/settings.service.js';

type Operation = { method: string; path: string; operationId?: string; summary?: string; tags: string[] };

export type ApiSurface = {
  globalPrefix: string;
  docsPath: string;
  info: { title: string; version: string; description?: string };
  tags: { name: string; description?: string }[];
  servers: { url: string }[];
  securitySchemes: Record<string, unknown>;
  operations: Operation[];
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export const readSurface = async (): Promise<ApiSurface> => {
  const environment = new EnvironmentService();
  // Typed as the Express application so the same helpers production uses apply
  // here; without the generic, Nest infers the adapter-agnostic interface and the
  // Express-specific plugin signatures no longer match.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, createHttpAdapter(), { bufferLogs: true, logger: false, rawBody: true });

  await registerHttpPlugins(app, environment);
  configureHttpApp(app, environment);
  await app.init();

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, { operationId?: string; summary?: string; tags?: string[] }>)[method];
      if (operation === undefined) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
        ...(operation.summary === undefined ? {} : { summary: operation.summary }),
        tags: operation.tags ?? []
      });
    }
  }

  const surface: ApiSurface = {
    globalPrefix: GLOBAL_PREFIX,
    docsPath: OPENAPI_PATH,
    info: {
      title: document.info.title,
      version: document.info.version,
      ...(document.info.description === undefined ? {} : { description: document.info.description })
    },
    tags: (document.tags ?? []).map(tag => ({ name: tag.name, ...(tag.description === undefined ? {} : { description: tag.description }) })),
    servers: (document.servers ?? []).map(server => ({ url: server.url })),
    securitySchemes: (document.components?.securitySchemes ?? {}) as Record<string, unknown>,
    operations: operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  };

  await app.get(SettingsService).stop().catch(() => undefined);
  await app.close();
  return surface;
};

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;

if (isEntrypoint) {
  const surface = await readSurface();
  // Defaults to the committed baseline so `npm run api:surface` always compares
  // the live application against the snapshot under test. Writing to a scratch
  // file by default let the command succeed while leaving the baseline stale.
  const target = resolve(process.cwd(), process.argv[2] ?? 'test/api-surface.baseline.json');
  writeFileSync(target, `${JSON.stringify(surface, null, 2)}\n`);
  process.stdout.write(`wrote ${surface.operations.length} operations to ${target}\n`);
  // Redis and BullMQ hold open handles that would keep the process alive
  // forever once Nest has closed; the snapshot is already on disk.
  process.exit(0);
}
