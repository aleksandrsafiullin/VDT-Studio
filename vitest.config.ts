import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "@vdt-studio/vdt-core": fileURLToPath(new URL("./packages/vdt-core/src/index.ts", import.meta.url)),
      "@vdt-studio/ai-harness": fileURLToPath(new URL("./packages/ai-harness/src/index.ts", import.meta.url))
    }
  }
});
