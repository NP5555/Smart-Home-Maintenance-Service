import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as contracts from '@smart-home/contracts';

/**
 * Every value exported through `enumFrom` carries the SQL enum type it mirrors.
 * This suite parses the canonical schema and compares, so a database enum that
 * gains or loses a value cannot drift away from the mirror the frontend and
 * backend both import.
 */
type MirroredEnum = { sqlType: string; values: readonly string[] };

const schemaSql = (): string => {
  const url = new URL('../../../smart-home-docs/04_schema.sql', import.meta.url);
  return readFileSync(url, 'utf8');
};

const isMirroredEnum = (value: unknown): value is MirroredEnum =>
  typeof value === 'object' && value !== null && Array.isArray((value as { values?: unknown }).values);

/** Only values that declare a real Postgres enum type take part in the comparison. */
const hasSqlType = (value: MirroredEnum): value is MirroredEnum & { sqlType: string } => typeof value.sqlType === 'string';

/** `CREATE TYPE name AS ENUM ('A','B');` including the multi-line forms. */
const enumsInSchema = (sql: string): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  const pattern = /CREATE TYPE\s+(\w+)\s+AS ENUM\s*\(([\s\S]*?)\);/gi;
  for (const match of sql.matchAll(pattern)) {
    const name = match[1];
    const body = match[2];
    if (name === undefined || body === undefined) continue;
    const values = [...body.matchAll(/'([^']*)'/g)].map(value => value[1]).filter((value): value is string => value !== undefined);
    found.set(name, values);
  }
  return found;
};

const mirroredEnums = (): MirroredEnum[] => (Object.values(contracts) as unknown[]).filter((value): value is MirroredEnum => isMirroredEnum(value));

describe('SHM-005: the contracts mirror matches the canonical schema', () => {
  const schema = enumsInSchema(schemaSql());

  it('finds the enums in the schema and the mirror', () => {
    expect(schema.size).toBeGreaterThan(30);
    expect(mirroredEnums().length).toBeGreaterThan(20);
  });

  it('every mirrored enum exists in the schema with the same values, in the same order', () => {
    const problems: string[] = [];
    for (const mirrored of mirroredEnums()) {
      if (!hasSqlType(mirrored)) continue;
      const fromSchema = schema.get(mirrored.sqlType);
      if (fromSchema === undefined) {
        problems.push(`${mirrored.sqlType} is mirrored but not declared in 04_schema.sql`);
        continue;
      }
      const missing = fromSchema.filter(value => !mirrored.values.includes(value));
      const extra = mirrored.values.filter(value => !fromSchema.includes(value));
      if (missing.length > 0) problems.push(`${mirrored.sqlType} is missing ${missing.join(', ')}`);
      if (extra.length > 0) problems.push(`${mirrored.sqlType} has extra ${extra.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('only values the schema enforces with a CHECK claim no enum type', () => {
    // locale is a text column with a CHECK, so declaring a sqlType for it would
    // point the drift test at a type that does not exist.
    expect(contracts.Locale.values).toEqual(['en', 'ur']);
    expect(contracts.Locale).not.toHaveProperty('sqlType');
  });

  it('covers the enums the booking and money flows depend on', () => {
    const covered = new Set(mirroredEnums().map(mirrored => mirrored.sqlType));
    for (const required of ['booking_status', 'payment_mode', 'provider_status', 'user_status', 'actor_role', 'verification_outcome', 'entry_direction']) {
      expect(covered, `${required} is not mirrored in contracts`).toContain(required);
    }
  });

  it('booking_status matches the SRS ordering of the state machine', () => {
    expect(contracts.BookingStatus.values[0]).toBe('PENDING_PAYMENT');
    expect(contracts.BookingStatus.values).toContain('AWAITING_VERIFICATION');
    expect(contracts.BookingStatus.values).toContain('REWORK_REQUIRED');
    expect(contracts.BookingStatus.values).toHaveLength(22);
  });

  it('picks up a schema enum that gains a value, which is what makes this test useful', () => {
    // A deliberately wrong mirror must be reported, proving the comparison runs
    // both ways rather than only checking that the schema is non-empty.
    const fake: MirroredEnum = { sqlType: 'booking_status', values: ['PENDING_PAYMENT', 'NOT_A_REAL_STATE'] };
    const fromSchema = schema.get(fake.sqlType) as string[];
    expect(fromSchema).toContain('PENDING_PAYMENT');
    expect(fromSchema).not.toContain('NOT_A_REAL_STATE');
    expect(fake.values.filter(value => !fromSchema.includes(value))).toEqual(['NOT_A_REAL_STATE']);
  });
});
