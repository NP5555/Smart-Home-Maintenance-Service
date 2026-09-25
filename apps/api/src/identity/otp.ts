import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;
export const OTP_DIGITS = '0123456789';

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export const TOTP_ALGORITHM: TotpAlgorithm = 'sha1';
const TOTP_DIGITS_COUNT = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_TOTP_STEP_SECONDS = 30;

export type OtpPurpose = 'REGISTER' | 'LOGIN' | 'PASSWORD_RESET' | 'PHONE_CHANGE';

export const generateOtpCode = (): string => {
  let code = '';
  for (let index = 0; index < OTP_LENGTH; index += 1) code += OTP_DIGITS[randomInt(0, OTP_DIGITS.length)];
  return code;
};

export const hmacSha256 = (secret: string, value: string): string => createHmac('sha256', secret).update(value).digest('hex');

/**
 * OTP codes are never stored in the clear. The pepper lives in the environment
 * (NFR-SE-08), so a leaked database alone does not allow offline code guessing.
 */
export const hashOtpCode = (pepper: string, target: string, purpose: OtpPurpose, code: string): string =>
  hmacSha256(pepper, `${purpose}:${target.trim().toLowerCase()}:${code}`);

export const constantTimeEquals = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

export const base32Encode = (input: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const base32Decode = (input: string): Buffer => {
  const normalised = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalised) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Base32 secret contains an unsupported character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

export const generateTotpSecret = (bytes = 20): string => base32Encode(randomBytes(bytes));

export const totpCodeAt = (secretBase32: string, counter: number, digits = TOTP_DIGITS_COUNT, algorithm: TotpAlgorithm = TOTP_ALGORITHM): string => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, base32Decode(secretBase32)).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0xf;
  const binary = ((digest[offset] ?? 0) & 0x7f) << 24 | ((digest[offset + 1] ?? 0) & 0xff) << 16 | ((digest[offset + 2] ?? 0) & 0xff) << 8 | ((digest[offset + 3] ?? 0) & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
};

export const totpCode = (secretBase32: string, at: Date, stepSeconds = DEFAULT_TOTP_STEP_SECONDS, digits = TOTP_DIGITS_COUNT, algorithm: TotpAlgorithm = TOTP_ALGORITHM): string =>
  totpCodeAt(secretBase32, Math.floor(at.getTime() / 1000 / stepSeconds), digits, algorithm);

/**
 * Verifies a submitted code against the current step and one step either side,
 * which tolerates clock drift without materially widening the window.
 */
export const verifyTotp = (secretBase32: string, code: string, at: Date, window = 1, stepSeconds = DEFAULT_TOTP_STEP_SECONDS): boolean => {
  const candidate = code.trim();
  if (!new RegExp(`^\\d{${TOTP_DIGITS_COUNT}}$`).test(candidate)) return false;
  const counter = Math.floor(at.getTime() / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    if (constantTimeEquals(totpCodeAt(secretBase32, counter + offset), candidate)) return true;
  }
  return false;
};

export const totpUri = (options: { secret: string; account: string; issuer: string }): string => {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
  const query = new URLSearchParams({ secret: options.secret, issuer: options.issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS_COUNT), period: String(DEFAULT_TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString()}`;
};
