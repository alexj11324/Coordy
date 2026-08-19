import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/main/test/**/*.spec.ts", "src/renderer/src/test/**/*.spec.ts"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
