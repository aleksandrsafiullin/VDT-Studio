import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@vdt-studio/vdt-core", "@vdt-studio/ai-harness", "@vdt-studio/ui"]
};

export default nextConfig;
