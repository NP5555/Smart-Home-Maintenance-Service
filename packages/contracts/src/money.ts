import { z } from 'zod';

export const CURRENCY = 'PKR' as const;

export const paisaSchema = z.bigint();

export const nonNegativePaisaSchema = z.bigint().min(0n);

export const moneySchema = z
  .object({
    amountPaisa: nonNegativePaisaSchema,
    currency: z.literal(CURRENCY)
  })
  .strict();

export type Paisa = bigint;
export type Currency = typeof CURRENCY;
export type Money = z.infer<typeof moneySchema>;

const MAX_SAFE_PAISA = 9_007_199_254_740_991n;

export const assertPaisa = (value: bigint): bigint => {
  if (typeof value !== 'bigint') throw new TypeError('Paisa must be a bigint');
  if (value > MAX_SAFE_PAISA || value < -MAX_SAFE_PAISA) throw new RangeError('Paisa exceeds the safe integer range');
  return value;
};

export const isPaisa = (value: unknown): value is Paisa => typeof value === 'bigint';

export const toMoney = (amountPaisa: Paisa): Money => ({ amountPaisa: assertPaisa(amountPaisa), currency: CURRENCY });

export const paisaSchemaFrom = (minimum: bigint) => z.bigint().min(minimum);

export const moneyJsonSchema = {
  type: 'object',
  required: ['amountPaisa', 'currency'],
  additionalProperties: false,
  properties: {
    amountPaisa: { type: 'integer', format: 'int64', description: 'Integer paisa. 100 paisa = PKR 1.' },
    currency: { type: 'string', enum: [CURRENCY] }
  }
} as const;
