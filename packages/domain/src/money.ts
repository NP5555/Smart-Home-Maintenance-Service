export type Paisa = bigint;

const BASIS_POINTS = 10_000n;
const MAX_SAFE_PAISA = 9_007_199_254_740_991n;
const ZERO: Paisa = 0n;

export const isPaisa = (value: unknown): value is Paisa => typeof value === 'bigint';

export const paisa = (value: bigint): Paisa => {
  if (value > MAX_SAFE_PAISA || value < -MAX_SAFE_PAISA) throw new RangeError('Paisa exceeds the safe integer range');
  return value;
};

const assertBasisPoints = (basisPoints: bigint): bigint => {
  if (basisPoints < 0n) throw new RangeError('Basis points must be non-negative');
  if (basisPoints > 1_000_000n) throw new RangeError('Basis points exceed 100 percent');
  return basisPoints;
};

export const roundHalfUp = (numerator: bigint, denominator: bigint): Paisa => {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive');
  const negative = numerator < 0n !== denominator < 0n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return paisa(negative ? -rounded : rounded);
};

export const zero = (): Paisa => ZERO;

export const addPaisa = (...values: bigint[]): Paisa => paisa(values.reduce((total, value) => total + value, ZERO));

export const subtractPaisa = (left: bigint, right: bigint): Paisa => paisa(left - right);

export const negatePaisa = (value: bigint): Paisa => paisa(-value);

export const sumPaisa = (values: readonly bigint[]): Paisa => addPaisa(...values);

export const maxPaisa = (left: bigint, right: bigint): Paisa => (left >= right ? left : right);

export const minPaisa = (left: bigint, right: bigint): Paisa => (left <= right ? left : right);

export const clampNonNegative = (value: bigint): Paisa => (value < ZERO ? ZERO : value);

export const isZeroPaisa = (value: bigint): boolean => value === ZERO;

export const isNegativePaisa = (value: bigint): boolean => value < ZERO;

export const absolutePaisa = (value: bigint): Paisa => paisa(value < ZERO ? -value : value);

export const percentOfPaisa = (amount: bigint, basisPoints: bigint): Paisa => roundHalfUp(amount * assertBasisPoints(basisPoints), BASIS_POINTS);

export const commissionOnPaisa = (amount: bigint, rateBasisPoints: bigint): Paisa => percentOfPaisa(amount, rateBasisPoints);

export const netOfCommissionPaisa = (amount: bigint, rateBasisPoints: bigint): Paisa => paisa(amount - percentOfPaisa(amount, rateBasisPoints));

export const scalePaisa = (amount: bigint, quantity: bigint): Paisa => paisa(amount * quantity);

export const dividePaisa = (amount: bigint, divisor: bigint): Paisa => {
  if (divisor === ZERO) throw new RangeError('Divisor must be non-zero');
  return roundHalfUp(amount, divisor);
};

export type Split = { total: Paisa; parts: Paisa[] };

export const splitEvenly = (amount: bigint, parts: number): Split => {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('Parts must be a positive integer');
  const count = BigInt(parts);
  const base = amount / count;
  const remainder = amount - base * count;
  const step = remainder === ZERO ? ZERO : remainder > ZERO ? 1n : -1n;
  const values = Array.from({ length: parts }, (_unused, index) => paisa(base + (BigInt(index) < (remainder < ZERO ? -remainder : remainder) ? step : ZERO)));
  return { total: paisa(values.reduce((total, value) => total + value, ZERO)), parts: values };
};

export const allocateByBasisPoints = (amount: bigint, basisPoints: bigint): { allocated: Paisa; remainder: Paisa } => {
  const allocated = percentOfPaisa(amount, basisPoints);
  return { allocated, remainder: paisa(amount - allocated) };
};

export const basisPointsOf = (amount: bigint, part: bigint): bigint => {
  if (amount === ZERO) throw new RangeError('Basis points of a zero amount are undefined');
  return roundHalfUp(part * BASIS_POINTS, amount);
};

export const toMajorUnits = (amount: bigint): bigint => amount / 100n;

export const toMinorUnits = (majorUnits: bigint): Paisa => paisa(majorUnits * 100n);

export const formatPaisa = (amount: bigint): string => {
  const absolute = amount < ZERO ? -amount : amount;
  const major = absolute / 100n;
  const minor = (absolute % 100n).toString().padStart(2, '0');
  return `${amount < ZERO ? '-' : ''}${major}.${minor}`;
};

export const assertSumEquals = (values: readonly bigint[], expected: bigint): Paisa => {
  const total = sumPaisa(values);
  if (total !== expected) throw new RangeError(`Balanced posting violated: debits and credits total ${total}, expected ${expected}`);
  return total;
};

export type PostingLine = { accountId: string; direction: 'DEBIT' | 'CREDIT'; amount: Paisa };

export const assertBalanced = (lines: readonly PostingLine[]): void => {
  if (lines.length < 2) throw new RangeError('A ledger transaction needs at least two lines');
  const debits = sumPaisa(lines.filter(line => line.direction === 'DEBIT').map(line => line.amount));
  const credits = sumPaisa(lines.filter(line => line.direction === 'CREDIT').map(line => line.amount));
  if (debits !== credits) throw new RangeError(`Unbalanced posting: debits ${debits}, credits ${credits}`);
  if (lines.some(line => line.amount <= ZERO)) throw new RangeError('Posting lines must be strictly positive');
};
