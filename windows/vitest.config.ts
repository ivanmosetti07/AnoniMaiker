import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Le prove col motore vero caricano un modello da centinaia di MB.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
