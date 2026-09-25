export type Paisa = bigint;

const assertPaisa = (value: bigint): void => {
  if (!Number.isSafeInteger(Number(value))) throw new RangeError('Paisa exceeds the safe integer range');
};

export const paisa = (value: bigint): Paisa => {
  assertPaisa(value);
  return value;
};

export const addMoney = (...values: bigint[]): Paisa => paisa(values.reduce((total, value) => total + value, 0n));

export const subtractMoney = (left: bigint, right: bigint): Paisa => paisa(left - right);

export const multiplyMoney = (amount: bigint, quantity: bigint): Paisa => paisa(amount * quantity);

export const percentOf = (amount: bigint, basisPoints: bigint): Paisa => {
  if (basisPoints < 0n) throw new RangeError('Basis points must be non-negative');
  return paisa((amount * basisPoints + 5_000n) / 10_000n);
};

export const allocateByBasisPoints = (amount: bigint, basisPoints: bigint): { amount: Paisa; remainder: Paisa } => {
  const allocated = percentOf(amount, basisPoints);
  return { amount: allocated, remainder: paisa(amount - allocated) };
};
