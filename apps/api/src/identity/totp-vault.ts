import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../common/domain-error.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * TOTP secrets are stored encrypted at rest. A fresh random nonce is generated
 * for every encryption and prefixed to the ciphertext, because reusing a GCM
 * nonce under one key leaks the authentication subkey. The stored layout is
 * `iv | authTag | ciphertext`.
 */
export const encryptTotpSecret = (key: Buffer, plaintext: string): Buffer => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

export const decryptTotpSecret = (key: Buffer, payload: Buffer): string => {
  if (payload.length <= IV_BYTES + TAG_BYTES) throw new DomainError('INTERNAL_ERROR', 'The stored TOTP secret is malformed');
  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DomainError('INTERNAL_ERROR', 'The stored TOTP secret could not be decrypted');
  }
};
