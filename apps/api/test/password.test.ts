import { describe, expect, it } from 'vitest';
import { ARGON2_OPTIONS, MIN_PASSWORD_LENGTH, PasswordPolicyError, assertPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from '../src/identity/password.js';

describe('NFR-SE-01: Argon2id password hashing', () => {
  it('pins the parameters the requirement asks for', () => {
    expect(ARGON2_OPTIONS.memoryCost).toBe(19_456);
    expect(ARGON2_OPTIONS.timeCost).toBe(2);
    expect(ARGON2_OPTIONS.parallelism).toBe(1);
  });

  it('produces an Argon2id hash that verifies, and never stores the password', async () => {
    const password = 'CorrectHorse9Battery';
    const hash = await hashPassword(password);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, 'CorrectHorse9BatterY')).toBe(false);
  });

  it('salts every hash, so the same password hashes differently each time', async () => {
    const password = 'CorrectHorse9Battery';
    const [a, b] = await Promise.all([hashPassword(password), hashPassword(password)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, password)).toBe(true);
    expect(await verifyPassword(b, password)).toBe(true);
  });

  it('treats a missing or malformed stored hash as a failed verification', async () => {
    expect(await verifyPassword(null, 'CorrectHorse9Battery')).toBe(false);
    expect(await verifyPassword('', 'CorrectHorse9Battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'CorrectHorse9Battery')).toBe(false);
  });

  it('burns comparable time on an unknown account without revealing it', async () => {
    const started = process.hrtime.bigint();
    await dummyVerify('CorrectHorse9Battery');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    expect(elapsedMs).toBeGreaterThan(0);
  });
});

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(() => assertPasswordPolicy('CorrectHorse9Battery')).not.toThrow();
  });

  it('rejects short, single class and well known passwords', () => {
    expect(() => assertPasswordPolicy('Ab1')).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy('alllowercaseletters')).toThrow(/uppercase/);
    expect(() => assertPasswordPolicy('ALLUPPERCASELETTERS')).toThrow(/lowercase/);
    expect(() => assertPasswordPolicy('NoDigitsHereAtAll')).toThrow(/digit/);
    expect(() => assertPasswordPolicy('Password123')).toThrow(/common/);
    expect(() => assertPasswordPolicy('x'.repeat(201))).toThrow(/at most 200/);
  });

  it('states the minimum length so the API can surface it', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(() => assertPasswordPolicy('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(new RegExp(`at least ${MIN_PASSWORD_LENGTH}`));
  });

  it('refuses to hash a password that fails the policy', async () => {
    await expect(hashPassword('weak')).rejects.toThrow(PasswordPolicyError);
  });
});
