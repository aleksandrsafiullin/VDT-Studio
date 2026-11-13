import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildIdentity } from "../../scripts/build-identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Preserve the byte identity checked by the parser host and artifact verifier. */
class PreserveParserWorkerAsset {
  apply(compiler) {
    const name = "PreserveParserWorkerAsset";
    compiler.hooks.thisCompilation.tap(name, (compilation) => {
      compilation.hooks.processAssets.tap({
        name,
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1
      }, () => {
        for (const asset of compilation.getAssets()) {
          if (/(?:^|\/)parser-worker\.[a-f0-9]+\.cjs$/.test(asset.name)) {
            // Next's SWC loader can rewrite the asset before minification.
            const workerPath = path.resolve(__dirname, "../../packages/data-harness/src/parser-worker.cjs");
            compilation.fileDependencies.add(workerPath);
            const original = new compiler.webpack.sources.RawSource(readFileSync(workerPath));
            compilation.updateAsset(asset.name, original, { ...asset.info, minimized: true });
          }
        }
      });
    });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: resolveBuildIdentity(path.join(__dirname, "../..")),
  // Feature test harnesses use an owned app view/build directory. Normal local
  // development keeps its existing cache and generated TypeScript files.
  distDir: process.env.VDT_NEXT_DIST_DIR?.trim() || ".next",
  devIndicators: false,
  webpack(config, { isServer }) {
    if (isServer) config.plugins.push(new PreserveParserWorkerAsset());
    return config;
  },
  output: process.env.VDT_NEXT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@vdt-studio/vdt-core",
    "@vdt-studio/vdt-agent",
    "@vdt-studio/vdt-agent-runtime",
    "@vdt-studio/data-harness",
    "@vdt-studio/storage",
    "@vdt-studio/ai-harness",
    "@vdt-studio/local-runner",
    "@vdt-studio/model-bridge",
    "@vdt-studio/ui"
  ]
};

export default nextConfig;
