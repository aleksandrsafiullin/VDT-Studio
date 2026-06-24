import { fileURLToPath } from "node:url";
import { runLocalRuntimeSidecar } from "./runtime";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runLocalRuntimeSidecar();
}

export { runLocalRuntimeSidecar };
