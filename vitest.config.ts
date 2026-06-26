import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "apps/**/*.test.ts", "apps/**/*.test.tsx", "scripts/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "@vdt-studio/vdt-core": fileURLToPath(new URL("./packages/vdt-core/src/index.ts", import.meta.url)),
      "@vdt-studio/vdt-agent": fileURLToPath(new URL("./packages/vdt-agent/src/index.ts", import.meta.url)),
      "@vdt-studio/ai-harness/browser": fileURLToPath(new URL("./packages/ai-harness/src/browser.ts", import.meta.url)),
      "@vdt-studio/ai-harness": fileURLToPath(new URL("./packages/ai-harness/src/index.ts", import.meta.url)),
      "@vdt-studio/cli": fileURLToPath(new URL("./packages/cli/src/index.ts", import.meta.url)),
      "@vdt-studio/model-bridge/node": fileURLToPath(new URL("./packages/model-bridge/src/node.ts", import.meta.url)),
      "@vdt-studio/model-bridge": fileURLToPath(new URL("./packages/model-bridge/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./apps/web", import.meta.url))
    }
  }
});
