import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['coverage/**', 'node_modules/**', 'artifacts/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        game: 'readonly',
        canvas: 'readonly',
        ui: 'readonly',
        Hooks: 'readonly',
        foundry: 'readonly',
        CONFIG: 'readonly',
        PIXI: 'readonly',
        Handlebars: 'readonly',
        ChatMessage: 'readonly',
        Roll: 'readonly',
        Item: 'readonly',
        Actor: 'readonly',
        CONST: 'readonly',
        fromUuid: 'readonly',
        fromUuidSync: 'readonly',
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      'no-empty': 'off',
      'no-useless-catch': 'off',
      'no-constant-binary-expression': 'off',
      'no-debugger': 'off',
    },
  },
];
