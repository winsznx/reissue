import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "integration",
          include: ["integration/**/*.test.ts"],
          globalSetup: ["support/global-setup.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
