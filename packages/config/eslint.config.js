import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['test/*.ts'] }, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-restricted-properties': ['error', { object: 'Prisma', property: 'status', message: 'Booking status is written only by BookingStateService.' }]
    }
  },
  { ignores: ['**/dist/**', '**/generated/**', '**/migrations/**'] }
);
