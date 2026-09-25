/**
 * Intentionally invalid. `no-restricted-syntax` must reject this file, which is
 * what the lint-fixtures test asserts. Never import or build this module.
 */
export const asNumber = (amount: bigint): number => Number(amount);

export const totalBalanceAsNumber = (balance: bigint): number => Number(balance);

export const commissionAsNumber = (commission: bigint): number => Number(commission);

export const perMonthFeeAsNumber = (fee: bigint): number => Number(fee);
