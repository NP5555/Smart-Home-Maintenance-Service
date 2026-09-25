import { describe, expect, it } from 'vitest';
import { buildProblem, errorCatalog, problemTypeFor, problemSchema, statusForCode, errorCodeValues } from '@smart-home/contracts';

describe('RFC 9457 problem documents', () => {
  it('builds a problem for every catalogue code with the documented status', () => {
    for (const code of errorCodeValues) {
      const problem = buildProblem({ code, detail: `${code} occurred`, instance: '/api/v1/bookings', requestId: 'req-1' });
      expect(problemSchema.safeParse(problem).success).toBe(true);
      expect(problem.status).toBe(errorCatalog[code].status);
      expect(problem.type).toBe(problemTypeFor(code));
      expect(problem.errors).toEqual([]);
    }
  });

  it('NFR-API-03: keeps field errors attached to the failing paths', () => {
    const problem = buildProblem({ code: 'VALIDATION_FAILED', detail: 'Request validation failed', errors: [{ path: 'phone', code: 'invalid_string', message: 'must be E.164' }] });
    expect(problem.status).toBe(422);
    expect(problem.errors[0]?.path).toBe('phone');
  });

  it('maps the business codes TRD §14.1 names explicitly', () => {
    expect(statusForCode('ILLEGAL_TRANSITION')).toBe(409);
    expect(statusForCode('SLOT_TAKEN')).toBe(409);
    expect(statusForCode('OTP_INVALID')).toBe(422);
    expect(statusForCode('CONFLICT_OF_INTEREST')).toBe(403);
    expect(statusForCode('DEBT_BLOCKED')).toBe(409);
    expect(statusForCode('OUTSIDE_CALLING_HOURS')).toBe(423);
  });

  it('never leaks a stack trace or an internal message in the type field', () => {
    const problem = buildProblem({ code: 'INTERNAL_ERROR', detail: 'An unexpected error occurred' });
    expect(problem.type).toBe('https://smart-home.local/problems/internal-error');
    expect(problem.detail).not.toContain('at ');
  });
});
