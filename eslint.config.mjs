import Module from 'node:module';

// typescript-eslint needs the TypeScript 6 JS API, while the project itself compiles with TypeScript 7 (native).
// `typescript6` is an alias of typescript@6 (devDependency); route typescript-eslint's `require('typescript')` to it.
// Remove this shim once typescript-eslint supports TypeScript 7.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolve.call(this, request === 'typescript' ? 'typescript6' : request, ...rest);
};

const { defineConfig, globalIgnores } = await import('eslint/config');
const { default: nextCoreWebVitals } = await import('eslint-config-next/core-web-vitals');
const { default: nextTypescript } = await import('eslint-config-next/typescript');

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Real-bug rules stay on (rules-of-hooks, exhaustive-deps, no-undef, no-unused-vars as warnings, ...).
      // The ones below are stylistic or React-Compiler advisories that the existing code violates on purpose
      // (latest-value refs, resetting state when a prop changes, dense one-line statements).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
      '@typescript-eslint/no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@next/next/no-img-element': 'off',
    },
  },
  globalIgnores(['.next/**', '.cache/**', 'node_modules/**', 'out/**', 'public/**', 'docs/**', 'next-env.d.ts', 'coverage/**']),
]);
