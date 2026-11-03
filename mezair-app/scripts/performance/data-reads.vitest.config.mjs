import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['scripts/performance/data-reads.test.ts'], testTimeout: 30000 },
});
