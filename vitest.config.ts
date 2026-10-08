import { defineConfig } from 'vitest/config';

// Tests run in plain Node, apart from vite.config.ts (whose plugins start the app's servers).
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
