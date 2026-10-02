import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config. The two project-specific bans below are the mechanical enforcement of
 * CLAUDE.md section 3: colours live only in styles/tokens.css, and `fetch` is called
 * only from src/api/.
 */
const HEX_COLOUR_BAN = {
  selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
  message:
    'Hex colours belong in src/styles/tokens.css. Use var(--token) or a value from /api/meta.',
};

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': ['error', HEX_COLOUR_BAN],
    },
  },
  {
    // Only src/api may talk to the network (CLAUDE.md section 3).
    files: ['src/components/**', 'src/pages/**', 'src/hooks/**', 'src/lib/**', 'src/store/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Call the server through src/api/client.ts.' },
        { name: 'XMLHttpRequest', message: 'Call the server through src/api/client.ts.' },
      ],
    },
  },
  {
    files: ['src/lib/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/api/*', '@/hooks/*', '@/components/*', '@/store/*', 'react', 'react-dom'],
              message: 'lib/ holds pure functions: no React, no network, no app layers above it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
