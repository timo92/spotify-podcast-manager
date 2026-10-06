import { defineConfig } from 'vitest/config';

// Coverage is measured only with `pnpm test:coverage` (CI on Ubuntu).
export default defineConfig({
  test: {
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'json-summary', 'html'] },
  },
});
