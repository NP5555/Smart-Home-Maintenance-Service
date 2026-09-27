/**
 * Dumps the public HTTP surface of the application so a refactor can prove it
 * did not move, rename or drop a single endpoint.
 *
 * The surface is read from the generated OpenAPI document rather than by
 * introspecting the HTTP adapter, because the OpenAPI document is built the
 * same way on every adapter. That means one command produces a comparable
 * snapshot on Fastify and on Express, which is the entire point: a diff
 * between the two runs is the evidence that the API did not change.
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createHttpAdapter } from '../src/adapter.js';
import { AppModule } from '../src/app.module.js';
import { EnvironmentService } from '../src/config/environment.service.js';
import { configureHttpApp, registerHttpPlugins } from '../src/http-app.js';
import { SettingsService } from '../src/platform/settings.service.js';

type Operation = { method: string; path: string; operationId?: string; summary?: string; tags: string[] };

export type ApiSurface = {
  globalPrefix: string;
  docsPath: string;
  operations: Operation[];
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export const readSurface = async (): Promise<ApiSurface> => {
  const environment = new EnvironmentService();
  const app = await NestFactory.create(AppModule, createHttpAdapter(environment.values.LOG_LEVEL, environment.isProduction), {
    bufferLogs: true,
    logger: false
  });

  await registerHttpPlugins(app, environment);
  configureHttpApp(app, environment);
  await app.init();

  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('surface').setVersion('1.0.0').build());
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
    globalPrefix: 'api/v1',
    docsPath: 'api/docs',
    operations: operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  };

  await app.get(SettingsService).stop().catch(() => undefined);
  await app.close();
  return surface;
};

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href;

if (isEntrypoint) {
  const surface = await readSurface();
  const target = resolve(process.cwd(), process.argv[2] ?? 'api-surface.json');
  writeFileSync(target, `${JSON.stringify(surface, null, 2)}\n`);
  process.stdout.write(`wrote ${surface.operations.length} operations to ${target}\n`);
  // Redis and BullMQ hold open handles that would keep the process alive
  // forever once Nest has closed; the snapshot is already on disk.
  process.exit(0);
}
