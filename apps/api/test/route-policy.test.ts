import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');

const collectFiles = (directory: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...collectFiles(path));
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) found.push(path);
  }
  return found;
};

const routeDecorators = ['@Get', '@Post', '@Put', '@Patch', '@Delete', '@Controller'];

const relative = (path: string): string => path.slice(sourceRoot.length + 1).replaceAll('\\', '/');

describe('every route declares an authorisation policy (TRD §16)', () => {
  const files = collectFiles(sourceRoot);
  const controllers = files.filter(file => routeDecorators.some(decorator => readFileSync(file, 'utf8').includes(decorator)));

  it('finds the controllers that make up the HTTP surface', () => {
    expect(controllers.length).toBeGreaterThan(0);
    expect(controllers.map(relative)).toEqual(expect.arrayContaining(['health/health.controller.ts', 'platform/settings.controller.ts', 'platform/payment-webhook.controller.ts', 'integrations/dev.controller.ts']));
  });

  it('NFR-SE-02: every route handler carries @Policy or @Public', () => {
    const missing: string[] = [];
    for (const file of controllers) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        const match = /^\s*@(Get|Post|Put|Patch|Delete)\b/.exec(line);
        if (match === null) continue;
        const window = lines.slice(index, index + 5).join('\n');
        if (!window.includes('@PolicyDecorator(') && !window.includes('@Public(')) missing.push(`${relative(file)}:${index + 1}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('never lets a route be declared without an accompanying policy decorator in the same block', () => {
    for (const file of controllers) {
      const source = readFileSync(file, 'utf8');
      const routeCount = (source.match(/^\s*@(Get|Post|Put|Patch|Delete)\(/gm) ?? []).length;
      const policyCount = (source.match(/@(PolicyDecorator\(|Public\(\))/g) ?? []).length;
      expect(policyCount, `${relative(file)} declares ${routeCount} routes but ${policyCount} policies`).toBeGreaterThanOrEqual(routeCount);
    }
  });
});
