import eslint from '@eslint/js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const bookingStatuses = 'PENDING_PAYMENT|ABANDONED|REQUESTED|UNFULFILLED|ACCEPTED|SCHEDULED|EN_ROUTE|IN_PROGRESS|QUOTE_REVISION|WORK_COMPLETED|AWAITING_VERIFICATION|REWORK_REQUIRED|VERIFIED|AUTO_RELEASED|DISPUTED|PAYMENT_RELEASED|PARTIALLY_REFUNDED|REFUNDED|CANCELLED_CUSTOMER|CANCELLED_PROVIDER|NO_SHOW|CLOSED';

/**
 * The write methods Prisma exposes, reached either bare (`update`) or through a
 * model handle (`prisma.booking.update`). Both shapes appear in real code, so
 * both have to be covered or the ban can be sidestepped by qualification.
 * `:has()` identifies the call; the ObjectExpression is a child of the call, not
 * of the Identifier, so the two cannot simply be chained.
 */
const prismaWriteCallee = 'CallExpression[callee.name=/^(update|updateMany|upsert|create|createMany)$/]';
const memberWriteCallee = 'CallExpression:has(MemberExpression > Identifier[name=/^(update|updateMany|upsert|create|createMany)$/])';
/**
 * The literal's own value lives at `value.value`; `[value.regex=...]` matches
 * nothing because `value` is the Literal node, not its string. Getting this
 * wrong silently disables the ban, so the lint-fixtures test pins it.
 */
const statusValue = `[key.name='status'][value.value=/^('|")?(${bookingStatuses})('|")?$/]`;

const statusWriteMessage = 'bookings.status is written only by BookingStateService.apply() inside a transaction.';
const moneyMessage = 'Money is bigint paisa. Use the helpers from @smart-home/domain, never Number().';

const rules = [
  'error',
  // `update({ status })` and `update({ data: { status } })` are both real shapes.
  { selector: `${prismaWriteCallee} > ObjectExpression > Property${statusValue}`, message: statusWriteMessage },
  { selector: `${prismaWriteCallee} > ObjectExpression > Property[key.name='data'] > ObjectExpression > Property${statusValue}`, message: statusWriteMessage },
  { selector: `${memberWriteCallee} > ObjectExpression > Property${statusValue}`, message: statusWriteMessage },
  { selector: `${memberWriteCallee} > ObjectExpression > Property[key.name='data'] > ObjectExpression > Property${statusValue}`, message: statusWriteMessage },
  // Case insensitive: the risk is a paisa value reaching Number(), whatever the
  // variable happens to be called.
  { selector: 'CallExpression[callee.name="Number"][arguments.0.type="Identifier"][arguments.0.name=/(paisa|amount|price|fee|commission|balance|debt|credit|wallet|escrow|refund|payout|total)/i]', message: moneyMessage }
];

export default tseslint.config(
  {
    // The banned-pattern fixtures are deliberately invalid, so lint must never
    // walk them during an ordinary run. Both patterns are needed: this config is
    // loaded from the repo root and from packages/config, which changes the base
    // path the patterns resolve against.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/migrations/**',
      '**/generated/**',
      '**/*.d.ts',
      'smart-home-docs/**',
      'packages/config/fixtures/**',
      'fixtures/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.mjs'] },
        tsconfigRootDir: packageRoot
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true, allowNullish: true }],
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-restricted-syntax': rules
    }
  },
  {
    files: ['**/test/**/*.ts', '**/seed/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked
  }
);
