import { defineConfig } from 'vitest/config';

// Unit + component + data-package tests. E2E lives in tests/e2e (Playwright).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/lib.ts', 'src/services.ts', 'src/components/**', 'src/content/**'],
      reporter: ['text', 'text-summary'],
    },
  },
});
