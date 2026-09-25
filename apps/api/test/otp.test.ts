import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, constantTimeEquals, generateOtpCode, generateTotpSecret, hashOtpCode, totpCode, totpUri, verifyTotp } from '../src/identity/otp.js';

const RFC6238_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('OTP codes', () => {
  it('generates six digit codes and rejects nothing about its own output', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('peppers the hash so the same code stored for two targets differs', () => {
    const code = '123456';
    const a = hashOtpCode('pepper-a', '+923001234567', 'REGISTER', code);
    const b = hashOtpCode('pepper-b', '+923001234567', 'REGISTER', code);
    const c = hashOtpCode('pepper-a', '+923009876543', 'REGISTER', code);
    const d = hashOtpCode('pepper-a', '+923001234567', 'PASSWORD_RESET', code);
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(a).toHaveLength(64);
  });

  it('normalises the target so case and padding do not change the hash', () => {
    expect(hashOtpCode('pepper', '  +923001234567 ', 'LOGIN', '000000')).toBe(hashOtpCode('pepper', '+923001234567', 'LOGIN', '000000'));
  });
});

describe('base32', () => {
  it('round trips arbitrary bytes (RFC 4648 test vectors)', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const encoded = base32Encode(Buffer.from(text, 'utf8'));
      expect(base32Decode(encoded).toString('utf8')).toBe(text);
    }
  });

  it('matches the published encodings', () => {
    expect(base32Encode(Buffer.from('foobar', 'utf8'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('fo', 'utf8'))).toBe('MZXQ');
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW6YTB01')).toThrow(/unsupported character/);
  });
});

describe('TOTP (RFC 6238)', () => {
  it('reproduces the published SHA-1 vectors for the 20 byte reference secret', () => {
    // RFC 6238 Appendix B, table 1. The secret for SHA-1 is "12345678901234567890".
    const vectors: readonly [number, string][] = [
      [59, '94287082'],
      [1_111_111_109, '07081804'],
      [1_111_111_111, '14050471'],
      [1_234_567_890, '89005924'],
      [2_000_000_000, '69279037'],
      [20_000_000_000, '65353130']
    ];
    const secret = base32Encode(Buffer.from('12345678901234567890', 'utf8'));
    for (const [seconds, code] of vectors) {
      expect(totpCode(secret, new Date(seconds * 1000), 30, 8), `T=${seconds}`).toBe(code);
    }
  });

  it('honours the algorithm parameter, which the provisioning URI pins to SHA1', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'utf8'));
    const at = new Date(1_111_111_109_000);
    expect(totpCode(secret, at, 30, 8, 'sha1')).toBe('07081804');
    expect(totpCode(secret, at, 30, 8, 'sha256')).not.toBe('07081804');
    expect(totpCode(secret, at, 30, 8, 'sha512')).not.toBe(totpCode(secret, at, 30, 8, 'sha256'));
    expect(totpUri({ secret, account: 'agent1@smart-home.local', issuer: 'Smart Home' })).toContain('algorithm=SHA1');
  });

  it('issues six digit codes and rolls over every 30 seconds', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    const at = new Date('2026-09-25T10:00:00.000Z');
    expect(totpCode(secret, at)).toMatch(/^\d{6}$/);
    expect(totpCode(secret, new Date(at.getTime() + 29_000))).toBe(totpCode(secret, at));
    expect(totpCode(secret, new Date(at.getTime() + 30_000))).not.toBe(totpCode(secret, at));
  });

  it('accepts the current step and one step either side, and nothing further out', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-09-25T10:00:00.000Z');
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() - 30_000)), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() + 30_000)), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() - 120_000)), now)).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, new Date(now.getTime() + 120_000)), now)).toBe(false);
  });

  it('rejects malformed codes without leaking a comparison result', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-09-25T10:00:00.000Z');
    for (const bad of ['', 'abcdef', '12345', '1234567', '12 456', totpCode(secret, new Date(now.getTime() - 600_000))]) {
      expect(verifyTotp(secret, bad, now)).toBe(false);
    }
  });

  it('builds a provisioning URI the standard authenticator apps understand', () => {
    const uri = totpUri({ secret: RFC6238_SECRET, account: 'admin@smart-home.local', issuer: 'Smart Home' });
    expect(uri.startsWith('otpauth://totp/Smart%20Home:admin%40smart-home.local?')).toBe(true);
    expect(uri).toContain('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('constant time comparison', () => {
  it('only matches identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
