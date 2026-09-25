import eslint from '@eslint/js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const bookingStatuses = 'PENDING_PAYMENT|ABANDONED|REQUESTED|UNFULFILLED|ACCEPTED|SCHEDULED|EN_ROUTE|IN_PROGRESS|QUOTE_REVISION|WORK_COMPLETED|AWAITING_VERIFICATION|REWORK_REQUIRED|VERIFIED|AUTO_RELEASED|DISPUTED|PAYMENT_RELEASED|PARTIALLY_REFUNDED|REFUNDED|CANCELLED_CUSTOMER|CANCELLED_PROVIDER|NO_SHOW|CLOSED';

const rules = [
  'error',
  {
    selector: `CallExpression[callee.name=/^(update|updateMany|upsert|create|createMany)$/] > ObjectExpression > Property[key.name='status'][value.regex=/^('|")?(${bookingStatuses})('|")?$/]`,
    message: 'bookings.status is written only by BookingStateService.apply() inside a transaction.'
  },
  {
    selector: 'CallExpression[callee.name="Number"]',
    message: 'Money is bigint paisa. Use the helpers from @smart-home/domain, never Number().'
  }
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**', '**/migrations/**', '**/generated/**', '**/*.d.ts', 'smart-home-docs/**']
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
      '@typescript-eslint/require-await': 'error',
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
