import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Component tests need a DOM; the core tests are environment-agnostic and
    // run fine in it too, so one environment keeps the config simple.
    environment: 'happy-dom',
  },
});
