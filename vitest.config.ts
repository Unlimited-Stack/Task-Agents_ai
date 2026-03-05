import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80
    }
  }
});
