/**
 * The counterpart to the banned fixtures: the shapes that must stay legal, so a
 * test can prove the rules are not simply failing on everything.
 */
export const readStatusAsText = (status: string): string => status.toUpperCase();

export const sumPaisa = (amount: bigint, fee: bigint): bigint => amount + fee;

export const countRows = (rows: number): number => Number(rows);
