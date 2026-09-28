import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSurface, type ApiSurface } from '../../scripts/api-surface.js';

/**
 * Guards the committed snapshot.
 *
 * `npm run api:surface` overwrites the baseline, which makes it a recorder, not
 * a check: a route that moves or disappears looks like a successful run. This
 * test reads the committed file instead and diffs the live application against
 * it, so a change to the public surface has to be made deliberately in the
 * baseline rather than absorbed by regenerating it.
 */
const readBaseline = async (): Promise<ApiSurface> => {
  const path = fileURLToPath(new URL('../api-surface.baseline.json', import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as ApiSurface;
};

const describeOperation = (operation: ApiSurface['operations'][number]): string =>
  `${operation.method} ${operation.path} (${operation.operationId ?? 'no operationId'})`;

describe('committed API surface', () => {
  it('matches the live application exactly', async () => {
    const [baseline, live] = await Promise.all([readBaseline(), readSurface()]);

    expect(live.globalPrefix).toBe(baseline.globalPrefix);
    expect(live.docsPath).toBe(baseline.docsPath);
    expect(live.info).toEqual(baseline.info);
    expect(live.tags).toEqual(baseline.tags);
    expect(live.servers).toEqual(baseline.servers);
    expect(live.securitySchemes).toEqual(baseline.securitySchemes);

    const expected = baseline.operations.map(describeOperation).sort();
    const actual = live.operations.map(describeOperation).sort();
    expect(actual).toEqual(expected);
  });

  it('detects a route that is missing from the live application', async () => {
    const baseline = await readBaseline();
    const live = await readSurface();

    const expected = baseline.operations.map(describeOperation).sort();
    const liveDescribed = live.operations.map(describeOperation).sort();
    // Proves the comparison above is load-bearing rather than vacuously equal:
    // dropping any single operation from the live surface has to break the match.
    expect(liveDescribed).toEqual(expected);
    for (const operation of live.operations) {
      const afterDrop = live.operations.filter(other => other !== operation).map(describeOperation).sort();
      expect(afterDrop, `dropping ${describeOperation(operation)} was not detected`).not.toEqual(expected);
    }
  });

  it('keeps the snapshot informative enough to catch a renamed or dropped route', async () => {
    const baseline = await readBaseline();

    // A snapshot with no operation ids or paths could not distinguish a rename
    // from a deletion, so the identifiers themselves are asserted to be present.
    expect(baseline.operations.length).toBeGreaterThan(0);
    for (const operation of baseline.operations) {
      expect(operation.operationId, `missing operationId for ${operation.method} ${operation.path}`).toBeTruthy();
    }
    // Health and the welcome route are deliberately unprefixed, so the prefix is
    // not a property of every path; what must hold is that no path is empty and
    // that everything outside the health set really is prefixed.
    const unprefixed = new Set(['/', '/health/live', '/health/ready', '/health/queues']);
    for (const operation of baseline.operations) {
      expect(operation.path, `empty path for ${operation.method}`).toBeTruthy();
      if (unprefixed.has(operation.path)) continue;
      expect(operation.path, `${operation.method} ${operation.path} should be under the global prefix`).toMatch(/^\/api\/v1\//);
    }
    expect(new Set(baseline.operations.map(operation => operation.operationId)).size).toBe(baseline.operations.length);
  });
});
