import { describe, expect, it } from 'vitest';
import {
  absolutePaisa,
  addPaisa,
  allocateByBasisPoints,
  assertBalanced,
  basisPointsOf,
  clampNonNegative,
  commissionOnPaisa,
  dividePaisa,
  formatPaisa,
  maxPaisa,
  minPaisa,
  netOfCommissionPaisa,
  paisa,
  percentOfPaisa,
  roundHalfUp,
  scalePaisa,
  splitEvenly,
  subtractPaisa,
  sumPaisa,
  toMajorUnits,
  toMinorUnits
} from '../src/money.js';

describe('integer paisa arithmetic', () => {
  it('adds, subtracts, sums and negates without losing precision', () => {
    expect(addPaisa(100n, 250n, 1n)).toBe(351n);
    expect(subtractPaisa(350n, 125n)).toBe(225n);
    expect(sumPaisa([9_007_199_254_740_990n, 1n])).toBe(9_007_199_254_740_991n);
    expect(absolutePaisa(-500n)).toBe(500n);
    expect(maxPaisa(-5n, -9n)).toBe(-5n);
    expect(minPaisa(-5n, -9n)).toBe(-9n);
    expect(clampNonNegative(-1n)).toBe(0n);
  });

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => paisa(9_007_199_254_740_992n)).toThrow(RangeError);
  });

  it('FR-PY-01: rounds basis points half-up, never toward zero', () => {
    expect(percentOfPaisa(101n, 5_000n)).toBe(51n);
    expect(percentOfPaisa(100n, 1_501n)).toBe(15n);
    expect(percentOfPaisa(1n, 5_000n)).toBe(1n);
    expect(percentOfPaisa(1n, 4_999n)).toBe(0n);
    expect(percentOfPaisa(-101n, 5_000n)).toBe(-51n);
    expect(percentOfPaisa(999n, 1_500n)).toBe(150n);
  });

  it('roundHalfUp rounds a half away from zero symmetrically', () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n);
    expect(roundHalfUp(-5n, 2n)).toBe(-3n);
    expect(roundHalfUp(4n, 2n)).toBe(2n);
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
  });

  it('FR-PY-02: commission and provider net always add back to the booking amount', () => {
    const amount = 1_234_567n;
    const rate = 1_500n;
    const commission = commissionOnPaisa(amount, rate);
    const net = netOfCommissionPaisa(amount, rate);
    expect(commission + net).toBe(amount);
    expect(commission).toBe(185_185n);
  });

  it('rejects out-of-range basis points', () => {
    expect(() => percentOfPaisa(100n, -1n)).toThrow(RangeError);
    expect(() => percentOfPaisa(100n, 1_000_001n)).toThrow(RangeError);
  });

  it('keeps the remainder when allocating a share', () => {
    expect(allocateByBasisPoints(10_001n, 1_500n)).toEqual({ allocated: 1_500n, remainder: 8_501n });
    expect(basisPointsOf(20_000n, 3_000n)).toBe(1_500n);
  });

  it('scales and divides with half-up rounding', () => {
    expect(scalePaisa(1_500n, 3n)).toBe(4_500n);
    expect(dividePaisa(1_000n, 3n)).toBe(333n);
    expect(dividePaisa(1_001n, 3n)).toBe(334n);
    expect(() => dividePaisa(1n, 0n)).toThrow(RangeError);
  });

  it('FR-PY-03: splits an amount without losing or inventing a single paisa', () => {
    const split = splitEvenly(1_000n, 3);
    expect(split.parts).toEqual([334n, 333n, 333n]);
    expect(split.total).toBe(1_000n);
    expect(splitEvenly(1_001n, 3).total).toBe(1_001n);
    expect(() => splitEvenly(1n, 0)).toThrow(RangeError);
  });

  it('converts between paisa and major units for display only', () => {
    expect(toMajorUnits(1_250n)).toBe(12n);
    expect(toMinorUnits(12n)).toBe(1_200n);
    expect(formatPaisa(1_250n)).toBe('12.50');
    expect(formatPaisa(-5n)).toBe('-0.05');
    expect(formatPaisa(0n)).toBe('0.00');
  });

  it('rejects an unbalanced ledger posting before it reaches the database', () => {
    expect(() => assertBalanced([{ accountId: 'a', direction: 'DEBIT', amount: 100n }])).toThrow(RangeError);
    expect(() => assertBalanced([{ accountId: 'a', direction: 'DEBIT', amount: 100n }, { accountId: 'b', direction: 'CREDIT', amount: 90n }])).toThrow(RangeError);
    expect(() => assertBalanced([{ accountId: 'a', direction: 'DEBIT', amount: 0n }, { accountId: 'b', direction: 'CREDIT', amount: 0n }])).toThrow(RangeError);
    expect(() =>
      assertBalanced([
        { accountId: 'gateway', direction: 'DEBIT', amount: 100n },
        { accountId: 'escrow', direction: 'CREDIT', amount: 40n },
        { accountId: 'commission', direction: 'CREDIT', amount: 60n }
      ])
    ).not.toThrow();
  });
});
