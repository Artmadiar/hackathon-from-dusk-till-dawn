import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false, // одна общая платформа и БД: файлы по очереди
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});
