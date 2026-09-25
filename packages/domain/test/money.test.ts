import { describe, expect, it } from 'vitest';
import { addMoney, allocateByBasisPoints, percentOf, subtractMoney } from '../src/money.js';

describe('money', () => {
  it('adds and subtracts integer paisa', () => {
    expect(addMoney(100n, 250n)).toBe(350n);
    expect(subtractMoney(350n, 125n)).toBe(225n);
  });

  it('FR-PY-07: rounds basis points half-up', () => {
    expect(percentOf(101n, 5_000n)).toBe(51n);
    expect(percentOf(100n, 1_501n)).toBe(16n);
  });

  it('preserves the provider remainder', () => {
    expect(allocateByBasisPoints(10_001n, 1_500n)).toEqual({ amount: 1_500n, remainder: 8_501n });
  });
});
