import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The singleton logger reads LOG_LEVEL at first import; keep test stderr clean.
    env: { LOG_LEVEL: 'ERROR' },
    testTimeout: 10_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // types/directus.ts is type-only declarations with zero runtime statements.
      exclude: ['src/types/**'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});
