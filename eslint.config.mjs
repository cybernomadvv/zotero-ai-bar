// @ts-check Let TS check this config file

import zotero from '@zotero-plugin/eslint-config';

export default zotero({
  overrides: [
    {
      files: ['**/*.ts'],
      rules: {
        // We disable this rule here because the template
        // contains some unused examples and variables
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
    {
      files: ['site/**/*.js'],
      languageOptions: {
        globals: {
          window: 'readonly',
          document: 'readonly',
          navigator: 'readonly',
          localStorage: 'readonly',
          innerHeight: 'readonly',
          scrollY: 'readonly',
          requestAnimationFrame: 'readonly',
          IntersectionObserver: 'readonly',
          Event: 'readonly',
        },
      },
    },
  ],
});
