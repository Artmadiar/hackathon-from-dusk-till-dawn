import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false, // одна общая БД platform_test
    testTimeout: 20000,
    hookTimeout: 90000,
  },
});
