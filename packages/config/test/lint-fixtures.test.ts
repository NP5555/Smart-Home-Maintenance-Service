import { ESLint } from 'eslint';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../eslint.config.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(packageRoot, 'fixtures');

const lintFile = async (file: string): Promise<string[]> => (await lintMessages(file)).map(message => message.ruleId);

type ConfigEntry = { ignores?: string[] };

/**
 * The shared config globally ignores the fixture directory, which is what keeps
 * a normal lint run green. The test needs that one entry narrowed, so the ignore
 * list is rebuilt without the fixture patterns rather than fighting ESLint.
 */
const configForFixtures = (): unknown[] => {
  const fixtureIgnores = new Set(['packages/config/fixtures/**', 'fixtures/**']);
  const rebuilt: unknown[] = [];
  for (const entry of config as unknown as ConfigEntry[]) {
    if (entry.ignores === undefined) {
      rebuilt.push(entry);
      continue;
    }
    const kept = entry.ignores.filter(pattern => !fixtureIgnores.has(pattern));
    rebuilt.push({ ...entry, ignores: kept });
  }
  return rebuilt;
};

const lintMessages = async (file: string): Promise<{ ruleId: string; message: string }[]> => {
  const eslint = new ESLint({ cwd: packageRoot, overrideConfigFile: true, overrideConfig: configForFixtures(), warnIgnored: false });
  const [result] = await eslint.lintText(readFileSync(path.join(fixtureDir, file), 'utf8'), { filePath: path.join(fixtureDir, file) });
  if (result === undefined) throw new Error(`eslint produced no result for ${file}`);
  return result.messages.map(message => ({ ruleId: message.ruleId ?? 'fatal', message: message.message }));
};

/** The messages declared on the banned selectors, read straight off the config. */
const declaredRuleMessages = (): string[] =>
  config.flatMap(entry => {
    const value = entry as { rules?: { 'no-restricted-syntax'?: unknown } };
    const rule = value.rules?.['no-restricted-syntax'];
    return Array.isArray(rule) ? rule.map(entry => String((entry as { message?: string }).message ?? '')) : [];
  });

const fixtures = (): string[] => readdirSync(fixtureDir).filter(name => name.endsWith('.ts'));

describe('SHM-001: every banned pattern has a fixture that makes lint fail', () => {
  it('has a fixture for each banned rule', () => {
    const names = fixtures();
    expect(names).toEqual(expect.arrayContaining(['banned-bookings-status.ts', 'banned-money-as-number.ts']));
  });

  it('rejects a bookings.status write outside the state machine', async () => {
    const rules = await lintFile('banned-bookings-status.ts');
    expect(rules).toContain('no-restricted-syntax');
  });

  it('rejects coercing paisa money to Number', async () => {
    const rules = await lintFile('banned-money-as-number.ts');
    expect(rules).toContain('no-restricted-syntax');
  });

  it('still accepts lookalike code that is not a money or status write', async () => {
    const rules = await lintFile('allowed-lookalikes.ts');
    expect(rules).not.toContain('no-restricted-syntax');
  });

  it('covers both the bare and the qualified Prisma write, and the nested data object', async () => {
    const messages = await lintMessages('banned-bookings-status.ts');
    const statusMessages = messages.filter(entry => entry.message.includes('BookingStateService'));
    expect(statusMessages.length).toBeGreaterThanOrEqual(3);
  });

  it('states both bans as messages a developer can act on', () => {
    const messages = declaredRuleMessages();
    expect(messages.some(message => message.includes('BookingStateService'))).toBe(true);
    expect(messages.some(message => message.includes('bigint paisa'))).toBe(true);
  });
});
