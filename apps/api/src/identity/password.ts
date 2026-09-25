import argon2 from 'argon2';

/**
 * NFR-SE-01 requires Argon2id with at least m=19 MiB, t=2, p=1. The parameters
 * are pinned here rather than taken from the environment so that a misconfigured
 * deployment cannot silently weaken password storage.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
} as const;

export const MIN_PASSWORD_LENGTH = 10;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

const COMMON_PASSWORDS = new Set(['password12', 'password123', '1234567890', 'qwerty12345', 'adminadmin1', 'smarthome12']);

export const assertPasswordPolicy = (password: string): void => {
  if (password.length < MIN_PASSWORD_LENGTH) throw new PasswordPolicyError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.length > 200) throw new PasswordPolicyError('Password must be at most 200 characters');
  if (!/[a-z]/.test(password)) throw new PasswordPolicyError('Password must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) throw new PasswordPolicyError('Password must contain an uppercase letter');
  if (!/\d/.test(password)) throw new PasswordPolicyError('Password must contain a digit');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) throw new PasswordPolicyError('Password is too common');
};

export const hashPassword = async (password: string): Promise<string> => {
  assertPasswordPolicy(password);
  return argon2.hash(password, ARGON2_OPTIONS);
};

export const verifyPassword = async (hash: string | null, password: string): Promise<boolean> => {
  if (hash === null || hash === '') return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};

/**
 * Burns roughly the same time as a real verification when the account does not
 * exist, so response timing does not disclose whether an identifier is known.
 */
export const dummyVerify = async (password: string): Promise<void> => {
  await argon2.verify(DUMMY_HASH, password).catch(() => false);
};

const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c21vaHRob21lLWR1bW15JHNhbHQ$J8Q1c0Y6o2rZ0n4Xw9mQ1E7vKc3sT5uB0dF6gH8jK2I';
