import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node APIs (http, timers, process) instead of a browser DOM.
    environment: 'node',

    // Which files are treated as tests. This replaces JUnitCore.runClasses().
    include: ['tests/**/*.test.ts'],

    // Never let the runner walk into build output or the frontend.
    exclude: ['node_modules', 'dist', 'prisma'],

    // Print each test name, not just a dot. Closer to the JUnit tree view.
    reporters: ['verbose'],

    // A hung simulation timer must not hang the suite forever.
    testTimeout: 10_000,
    hookTimeout: 10_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // index.ts boots a real server; types.ts is types only. Neither is testable.
      exclude: ['src/index.ts', 'src/types.ts', 'src/db/prisma.ts'],
    },
  },
});
